from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
import razorpay
import sqlite3
import os
import hmac
import hashlib
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'dturf_secret_2026')

RAZORPAY_KEY_ID     = os.getenv('RAZORPAY_KEY_ID')
RAZORPAY_KEY_SECRET = os.getenv('RAZORPAY_KEY_SECRET')
SMTP_EMAIL          = os.getenv('SMTP_EMAIL')
SMTP_PASSWORD       = os.getenv('SMTP_PASSWORD')

rzp_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))

SLOT_PRICE_PAISE = 49900  # ₹499

def get_db_connection():
    conn = sqlite3.connect('database.db')
    conn.row_factory = sqlite3.Row
    return conn

def send_notifications(booking_id):
    # Send email notification logic (same as before)
    pass

@app.route('/')
def home():
    is_admin = False
    if 'user_id' in session:
        conn = get_db_connection()
        user = conn.execute('SELECT phone FROM users WHERE id = ?', (session['user_id'],)).fetchone()
        conn.close()
        if user and user['phone'] == '7041053127': is_admin = True
    return render_template('index.html', razorpay_key_id=RAZORPAY_KEY_ID, is_admin=is_admin)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        phone, password = request.form['phone'], request.form['password']
        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE phone = ?', (phone,)).fetchone()
        conn.close()
        if user and check_password_hash(user['password_hash'], password):
            session['user_id'], session['user_name'] = user['id'], user['name']
            return redirect(url_for('home'))
        return render_template('login.html', error="Invalid details")
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        name, phone, email, password = request.form['name'], request.form['phone'], request.form.get('email', ''), request.form['password']
        conn = get_db_connection()
        try:
            conn.execute('INSERT INTO users (name, phone, email, password_hash) VALUES (?, ?, ?, ?)',
                         (name, phone, email, generate_password_hash(password)))
            conn.commit(); return redirect(url_for('login'))
        except: return render_template('register.html', error="Phone or Email already registered.")
        finally: conn.close()
    return render_template('register.html')

@app.route('/ticket/<int:booking_id>')
def view_ticket(booking_id):
    conn = get_db_connection()
    # Ensure we only show a ticket if it's confirmed
    booking_check = conn.execute('SELECT razorpay_payment_id FROM bookings WHERE id = ? AND status = "Confirmed"', (booking_id,)).fetchone()
    if not booking_check:
        conn.close()
        return "Booking not confirmed or not found.", 404
        
    bookings = conn.execute('''
        SELECT b.*, u.name as user_name FROM bookings b JOIN users u ON b.user_id = u.id 
        WHERE b.razorpay_payment_id = ? AND b.status = "Confirmed"
    ''', (booking_check['razorpay_payment_id'],)).fetchall()
    
    if not bookings: 
        conn.close()
        return "Ticket not found.", 404
        
    all_times = ", ".join([b['time'] for b in bookings])
    booking_data = {
        "id": bookings[0]['id'],
        "user_name": bookings[0]['user_name'],
        "date": bookings[0]['date'],
        "time": all_times
    }
    conn.close()
    return render_template('ticket.html', booking=booking_data)

@app.route('/api/create-order', methods=['POST'])
def create_order():
    if 'user_id' not in session: return jsonify({"error": "Login required"}), 401
    data = request.json
    date, times = data.get('date'), data.get('times', [])
    if not date or not times: return jsonify({"error": "Select slots"}), 400

    conn = get_db_connection()
    # CRITICAL: Check if any of these slots are already CONFIRMED
    for t in times:
        existing = conn.execute('SELECT id FROM bookings WHERE date = ? AND time = ? AND status = "Confirmed"', (date, t)).fetchone()
        if existing:
            conn.close()
            return jsonify({"error": f"Slot {t} is already booked!"}), 400

    total_amount = len(times) * SLOT_PRICE_PAISE
    try:
        rzp_order = rzp_client.order.create({"amount": total_amount, "currency": "INR", "receipt": f"bulk_{session['user_id']}"})
        for t in times:
            conn.execute('INSERT INTO bookings (user_id, date, time, status, razorpay_order_id) VALUES (?, ?, ?, ?, ?)',
                         (session['user_id'], date, t, 'Pending', rzp_order['id']))
        user = conn.execute('SELECT phone, name FROM users WHERE id = ?', (session['user_id'],)).fetchone()
        conn.commit(); conn.close()
        return jsonify({
            "success": True, 
            "order_id": rzp_order['id'], 
            "amount": total_amount, 
            "currency": "INR", 
            "user_name": user['name'], 
            "user_phone": user['phone']
        })
    except Exception as e: 
        conn.close()
        return jsonify({"error": str(e)}), 500

@app.route('/api/verify-payment', methods=['POST'])
def verify_payment():
    data = request.json
    order_id, pay_id, sig = data.get('razorpay_order_id'), data.get('razorpay_payment_id'), data.get('razorpay_signature')
    
    # Signature verification
    body = f"{order_id}|{pay_id}"
    expected_sig = hmac.new(RAZORPAY_KEY_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    if expected_sig != sig: return jsonify({"error": "Invalid signature"}), 400

    conn = get_db_connection()
    conn.execute('UPDATE bookings SET status = "Confirmed", razorpay_payment_id = ? WHERE razorpay_order_id = ?', (pay_id, order_id))
    first_booking = conn.execute('SELECT id FROM bookings WHERE razorpay_order_id = ? LIMIT 1', (order_id,)).fetchone()
    conn.commit(); conn.close()
    
    return jsonify({"success": True, "booking_id": first_booking['id']})

@app.route('/api/slots')
def get_slots():
    date = request.args.get('date')
    conn = get_db_connection()
    # Only fetch slots that are CONFIRMED
    booked = conn.execute('SELECT time FROM bookings WHERE date = ? AND status = "Confirmed"', (date,)).fetchall()
    conn.close()
    return jsonify({"booked_slots": [b['time'] for b in booked]})

@app.route('/admin/scan')
def admin_scan(): return render_template('admin_scan.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('home'))

if __name__ == '__main__':
    app.run(debug=True, port=5000)
