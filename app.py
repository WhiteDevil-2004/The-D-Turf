from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
import razorpay
import sqlite3
import os
import hmac
import hashlib

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'dturf_2026_super_secure')

RAZORPAY_KEY_ID     = os.getenv('RAZORPAY_KEY_ID')
RAZORPAY_KEY_SECRET = os.getenv('RAZORPAY_KEY_SECRET')

rzp_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
SLOT_PRICE_PAISE = 49900 

def get_db_connection():
    conn = sqlite3.connect('database.db')
    conn.row_factory = sqlite3.Row
    return conn

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
        return render_template('login.html', error="Invalid login details")
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        name, phone, email, password = request.form['name'], request.form['phone'], request.form.get('email', ''), request.form['password']
        conn = get_db_connection()
        try:
            conn.execute('INSERT INTO users (name, phone, email, password_hash) VALUES (?, ?, ?, ?)',
                         (name, phone, email, generate_password_hash(password)))
            conn.commit()
            return redirect(url_for('login'))
        except: return render_template('register.html', error="User already exists")
        finally: conn.close()
    return render_template('register.html')

@app.route('/ticket/<int:booking_id>')
def view_ticket(booking_id):
    conn = get_db_connection()
    # Security: Verify booking is confirmed
    booking = conn.execute('SELECT razorpay_order_id, status FROM bookings WHERE id = ?', (booking_id,)).fetchone()
    if not booking or booking['status'] != 'Confirmed':
        conn.close()
        return "Ticket not confirmed yet.", 403
    
    # Get all slots for this payment
    results = conn.execute('''
        SELECT b.*, u.name as user_name FROM bookings b JOIN users u ON b.user_id = u.id 
        WHERE b.razorpay_order_id = ? AND b.status = "Confirmed"
    ''', (booking['razorpay_order_id'],)).fetchall()
    conn.close()
    
    if not results: return "No confirmed slots.", 404
    all_times = ", ".join([r['time'] for r in results])
    return render_template('ticket.html', booking={"id": results[0]['id'], "user_name": results[0]['user_name'], "date": results[0]['date'], "time": all_times})

@app.route('/api/create-order', methods=['POST'])
def create_order():
    if 'user_id' not in session: return jsonify({"error": "Please login"}), 401
    data = request.json
    date, times = data.get('date'), data.get('times', [])
    
    conn = get_db_connection()
    # Check for already confirmed slots
    for t in times:
        if conn.execute('SELECT id FROM bookings WHERE date = ? AND time = ? AND status = "Confirmed"', (date, t)).fetchone():
            conn.close()
            return jsonify({"error": f"Slot {t} is already booked!"}), 400

    total = len(times) * SLOT_PRICE_PAISE
    try:
        order = rzp_client.order.create({"amount": total, "currency": "INR", "receipt": f"u{session['user_id']}"})
        for t in times:
            conn.execute('INSERT INTO bookings (user_id, date, time, status, razorpay_order_id) VALUES (?, ?, ?, ?, ?)',
                         (session['user_id'], date, t, 'Pending', order['id']))
        user = conn.execute('SELECT phone, name FROM users WHERE id = ?', (session['user_id'],)).fetchone()
        conn.commit(); conn.close()
        return jsonify({"success": True, "order_id": order['id'], "amount": total, "user_name": user['name'], "user_phone": user['phone']})
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/api/verify-payment', methods=['POST'])
def verify_payment():
    data = request.json
    order_id, pay_id, sig = data.get('razorpay_order_id'), data.get('razorpay_payment_id'), data.get('razorpay_signature')
    
    # HARD SIGNATURE VERIFICATION
    params = {'razorpay_order_id': order_id, 'razorpay_payment_id': pay_id, 'razorpay_signature': sig}
    try:
        rzp_client.utility.verify_payment_signature(params)
        conn = get_db_connection()
        conn.execute('UPDATE bookings SET status = "Confirmed", razorpay_payment_id = ? WHERE razorpay_order_id = ?', (pay_id, order_id))
        first = conn.execute('SELECT id FROM bookings WHERE razorpay_order_id = ? LIMIT 1', (order_id,)).fetchone()
        conn.commit(); conn.close()
        return jsonify({"success": True, "booking_id": first['id']})
    except:
        return jsonify({"success": False, "error": "Security verification failed"}), 400

@app.route('/api/slots')
def get_slots():
    date = request.args.get('date')
    conn = get_db_connection()
    booked = conn.execute('SELECT time FROM bookings WHERE date = ? AND status = "Confirmed"', (date,)).fetchall()
    conn.close()
    return jsonify({"booked_slots": [b['time'] for b in booked]})

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('home'))

@app.route('/admin/scan')
def admin_scan(): return render_template('admin_scan.html')

@app.route('/admin/verify-api/<int:booking_id>')
def verify_api(booking_id):
    conn = get_db_connection()
    b = conn.execute('SELECT b.*, u.name FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.id = ? AND b.status = "Confirmed"', (booking_id,)).fetchone()
    conn.close()
    if b: return jsonify({"success": True, "name": b['name'], "date": b['date'], "time": b['time']})
    return jsonify({"success": False, "error": "Invalid ticket"})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
