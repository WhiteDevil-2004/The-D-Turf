document.addEventListener('DOMContentLoaded', () => {
    // 1. Splash Screen
    const splash = document.getElementById('splash-screen');
    if (splash) setTimeout(() => { splash.style.opacity = '0'; setTimeout(() => splash.style.visibility = 'hidden', 800); }, 2000);

    // 2. Selectors
    const datePicker = document.getElementById('booking-date'), slotsGrid = document.getElementById('slots-grid');
    const summaryTime = document.getElementById('summary-time'), summaryPrice = document.getElementById('summary-price');
    const payBtn = document.getElementById('pay-btn'), bookingForm = document.getElementById('booking-form');

    let selectedSlots = [];
    const PRICE_PER_SLOT = 499;

    // 3. Render Slots
    const availableSlots = ["06:00 AM", "07:00 AM", "08:00 AM", "09:00 AM", "10:00 AM", "04:00 PM", "05:00 PM", "06:00 PM", "07:00 PM", "08:00 PM", "09:00 PM", "10:00 PM"];
    const today = new Date().toISOString().split('T')[0];
    if (datePicker) { datePicker.min = today; datePicker.value = today; renderSlots(today); }
    if (datePicker) datePicker.addEventListener('change', (e) => { selectedSlots = []; updateSummary(); renderSlots(e.target.value); });

    function renderSlots(date) {
        slotsGrid.innerHTML = '<div class="loader">Loading...</div>';
        fetch(`/api/slots?date=${date}`).then(res => res.json()).then(data => {
            slotsGrid.innerHTML = '';
            const booked = data.booked_slots || [];
            availableSlots.forEach(time => {
                const isBooked = booked.includes(time);
                const slotEl = document.createElement('div');
                slotEl.className = `slot ${isBooked ? 'booked' : ''}`;
                slotEl.textContent = time;
                if (!isBooked) slotEl.onclick = () => {
                    slotEl.classList.toggle('selected');
                    if (slotEl.classList.contains('selected')) selectedSlots.push(time);
                    else selectedSlots = selectedSlots.filter(s => s !== time);
                    updateSummary();
                };
                slotsGrid.appendChild(slotEl);
            });
        });
    }

    function updateSummary() {
        const total = selectedSlots.length * PRICE_PER_SLOT;
        summaryTime.textContent = selectedSlots.length > 0 ? selectedSlots.sort().join(", ") : '-';
        summaryPrice.textContent = `₹${total || PRICE_PER_SLOT}`;
        if (payBtn) {
            payBtn.disabled = selectedSlots.length === 0;
            payBtn.textContent = `Pay ₹${total || PRICE_PER_SLOT} via UPI 🏏`;
        }
    }

    // 4. Razorpay Payment Logic
    if (bookingForm) {
        bookingForm.onsubmit = (e) => {
            e.preventDefault();
            if (selectedSlots.length === 0) return alert('Pehle slot select karein!');

            payBtn.disabled = true;
            payBtn.textContent = '⏳ Waiting for UPI...';

            fetch('/api/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: datePicker.value, times: selectedSlots })
            })
            .then(res => res.json()).then(data => {
                if (!data.success) { alert(data.error); payBtn.disabled = false; return; }

                // RAZORPAY CONFIG (UPI FIRST)
                const options = {
                    key: payBtn.dataset.key,
                    amount: data.amount,
                    currency: "INR",
                    name: "THE 'D' TURF",
                    description: `${selectedSlots.length} Slots Booking`,
                    image: "https://thedturf.onrender.com/static/img/logo.jpg", // Logo URL
                    order_id: data.order_id,
                    prefill: {
                        name: data.user_name,
                        contact: data.user_phone,
                        method: 'upi' // UPI ko priority deta hai
                    },
                    config: {
                        display: {
                            hide: [{ method: 'paylater' }, { method: 'card' }], // Inhe chhupa do
                            preferences: { show_default_blocks: true }
                        }
                    },
                    theme: { color: "#d11a2a" },
                    handler: function (response) {
                        fetch('/api/verify-payment', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(response)
                        })
                        .then(r => r.json()).then(v => {
                            if (v.success) window.location.href = `/ticket/${v.booking_id}`;
                            else alert('Payment Verification Failed!');
                        });
                    },
                    modal: { ondismiss: function() { payBtn.disabled = false; updateSummary(); } }
                };
                const rzp = new Razorpay(options);
                rzp.open();
            }).catch(err => {
                alert('Error: ' + err);
                payBtn.disabled = false;
            });
        };
    }
});
