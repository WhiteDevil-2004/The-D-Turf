from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
import razorpay
import sqlite3
import os
import hmac
import hashlib
from datetime import datetime
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'dturf_2026_super_secure')

RAZORPAY_KEY_ID     = os.getenv('RAZORPAY_KEY_ID')
RAZORPAY_KEY_SECRET = os.getenv('RAZORPAY_KEY_SECRET')
SMTP_EMAIL          = os.getenv('SMTP_EMAIL', 'thedturf@gmail.com')
SMTP_PASSWORD       = os.getenv('SMTP_PASSWORD')

rzp_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
LAUNCH_DATE = datetime(2026, 5, 2)

def get_db_connection():
    conn = sqlite3.connect('database.db')
    conn.row_factory = sqlite3.Row
    return conn

def calculate_price(date_str):
    dt = datetime.strptime(date_str, '%Y-%m-%d')
    is_weekend = dt.weekday() >= 5
    base = 1200 if is_weekend else 1000
    days_since_launch = (dt - LAUNCH_DATE).days + 1
    if days_since_launch <= 10: return base, base * 0.50
    return base, base

def send_email(to_email, subject, body):
    if not SMTP_PASSWORD: return
    try:
        msg = MIMEMultipart()
        msg['From'] = SMTP_EMAIL
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(SMTP_EMAIL, SMTP_PASSWORD)
        server.send_message(msg)
        server.quit()
    except Exception as e: print(f"Email Error: {e}")

@app.route('/')
def home():
    is_admin = False
    if 'user_id' in session:
        conn = get_db_connection()
        user = conn.execute('SELECT phone FROM users WHERE id = ?', (session['user_id'],)).fetchone()
        conn.close()
        if user and user['phone'] == '9016658360': is_admin = True
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
            conn.commit(); return redirect(url_for('login'))
        except: return render_template('register.html', error="User already exists")
        finally: conn.close()
    return render_template('register.html')

@app.route('/api/create-order', methods=['POST'])
def create_order():
    if 'user_id' not in session: return jsonify({"error": "Please login"}), 401
    data = request.json
    date, times = data.get('date'), data.get('times', [])
    conn = get_db_connection()
    total_paise = 0
    _, disc = calculate_price(date)
    for t in times:
        if conn.execute('SELECT id FROM bookings WHERE date = ? AND time = ? AND status = "Confirmed"', (date, t)).fetchone():
            conn.close(); return jsonify({"error": f"Slot {t} booked!"}), 400
        total_paise += int(disc * 100)
    try:
        order = rzp_client.order.create({"amount": total_paise, "currency": "INR", "receipt": f"u{session['user_id']}"})
        for t in times:
            conn.execute('INSERT INTO bookings (user_id, date, time, status, razorpay_order_id) VALUES (?, ?, ?, ?, ?)',
                         (session['user_id'], date, t, 'Pending', order['id']))
        user = conn.execute('SELECT phone, name FROM users WHERE id = ?', (session['user_id'],)).fetchone()
        conn.commit(); conn.close()
        return jsonify({"success": True, "order_id": order['id'], "amount": total_paise, "user_name": user['name'], "user_phone": user['phone']})
    except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/api/verify-payment', methods=['POST'])
def verify_payment():
    data = request.json
    order_id, pay_id, sig = data.get('razorpay_order_id'), data.get('razorpay_payment_id'), data.get('razorpay_signature')
    try:
        rzp_client.utility.verify_payment_signature({'razorpay_order_id': order_id, 'razorpay_payment_id': pay_id, 'razorpay_signature': sig})
        conn = get_db_connection()
        conn.execute('UPDATE bookings SET status = "Confirmed", razorpay_payment_id = ? WHERE razorpay_order_id = ?', (pay_id, order_id))
        info = conn.execute('SELECT b.*, u.name, u.phone FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.razorpay_order_id = ?', (order_id,)).fetchall()
        
        # Email to owner
        slots_str = ", ".join([i['time'] for i in info])
        body = f"New Booking!\nName: {info[0]['name']}\nPhone: {info[0]['phone']}\nDate: {info[0]['date']}\nSlots: {slots_str}"
        send_email(SMTP_EMAIL, "🏏 NEW BOOKING!", body)
        
        conn.commit(); conn.close()
        return jsonify({"success": True, "booking_id": info[0]['id']})
    except: return jsonify({"success": False, "error": "Security failed"}), 400

@app.route('/api/slots')
def get_slots():
    date = request.args.get('date')
    conn = get_db_connection()
    booked = conn.execute('SELECT time FROM bookings WHERE date = ? AND status = "Confirmed"', (date,)).fetchall()
    conn.close(); return jsonify({"booked_slots": [b['time'] for b in booked]})

@app.route('/ticket/<int:booking_id>')
def view_ticket(booking_id):
    conn = get_db_connection()
    booking = conn.execute('SELECT razorpay_order_id, status FROM bookings WHERE id = ?', (booking_id,)).fetchone()
    if not booking or booking['status'] != 'Confirmed':
        conn.close(); return "Not confirmed", 403
    results = conn.execute('SELECT b.*, u.name as user_name FROM bookings b JOIN users u ON b.user_id = u.id WHERE b.razorpay_order_id = ?', (booking['razorpay_order_id'],)).fetchall()
    conn.close()
    return render_template('ticket.html', booking={"id": results[0]['id'], "user_name": results[0]['user_name'], "date": results[0]['date'], "time": ", ".join([r['time'] for r in results])})

@app.route('/logout')
def logout():
    session.clear(); return redirect(url_for('home'))

@app.route('/admin/scan')
def admin_scan(): return render_template('admin_scan.html')

if __name__ == '__main__':
    app.run(debug=True, port=5000)
