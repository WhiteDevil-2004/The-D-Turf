document.addEventListener('DOMContentLoaded', () => {

    // ── Splash Screen ────────────────────────────────────────────────────────
    const splashScreen = document.getElementById('splash-screen');
    if (splashScreen) {
        setTimeout(() => {
            splashScreen.style.opacity = '0';
            setTimeout(() => { splashScreen.style.visibility = 'hidden'; }, 800);
        }, 2000);
    }

    const datePicker  = document.getElementById('booking-date');
    const slotsGrid   = document.getElementById('slots-grid');
    const summaryDate = document.getElementById('summary-date');
    const summaryTime = document.getElementById('summary-time');
    const summaryPrice = document.getElementById('summary-price');
    const payBtn      = document.getElementById('pay-btn');
    const bookingForm = document.getElementById('booking-form');

    let selectedSlots = [];
    const PRICE_PER_SLOT = 499;

    const today = new Date().toISOString().split('T')[0];
    if (datePicker) {
        datePicker.min = today;
        datePicker.value = today;
        renderSlots(today);
    }

    const availableSlots = [
        "06:00 AM", "07:00 AM", "08:00 AM", "09:00 AM", "10:00 AM",
        "04:00 PM", "05:00 PM", "06:00 PM", "07:00 PM", "08:00 PM",
        "09:00 PM", "10:00 PM"
    ];

    if (datePicker) {
        datePicker.addEventListener('change', (e) => {
            summaryDate.textContent = formatDate(e.target.value);
            selectedSlots = [];
            updateSummary();
            renderSlots(e.target.value);
        });
    }

    function renderSlots(date) {
        slotsGrid.innerHTML = '<p style="color:#aaa; padding:1rem;">⏳ Loading slots...</p>';
        fetch(`/api/slots?date=${date}`)
            .then(res => res.json())
            .then(data => {
                slotsGrid.innerHTML = '';
                const bookedSlots = data.booked_slots || [];
                availableSlots.forEach(time => {
                    const isBooked = bookedSlots.includes(time);
                    const slotEl   = document.createElement('div');
                    slotEl.className = `slot ${isBooked ? 'booked' : ''}`;
                    slotEl.textContent = time;
                    if (!isBooked) {
                        slotEl.addEventListener('click', () => toggleSlot(slotEl, time));
                    }
                    slotsGrid.appendChild(slotEl);
                });
            })
            .catch(() => {
                slotsGrid.innerHTML = '<p style="color:red">❌ Failed to load slots.</p>';
            });
    }

    function toggleSlot(slotElement, time) {
        if (slotElement.classList.contains('selected')) {
            slotElement.classList.remove('selected');
            selectedSlots = selectedSlots.filter(s => s !== time);
        } else {
            slotElement.classList.add('selected');
            selectedSlots.push(time);
        }
        updateSummary();
    }

    function updateSummary() {
        if (selectedSlots.length > 0) {
            summaryTime.textContent = selectedSlots.sort().join(", ");
            const total = selectedSlots.length * PRICE_PER_SLOT;
            summaryPrice.textContent = `₹${total} (${selectedSlots.length} slots)`;
            if (payBtn) {
                payBtn.disabled = false;
                payBtn.textContent = `Proceed to Pay ₹${total} 🏏`;
            }
        } else {
            summaryTime.textContent = '-';
            summaryPrice.textContent = `₹${PRICE_PER_SLOT} / hr`;
            if (payBtn) {
                payBtn.disabled = true;
                payBtn.textContent = `Proceed to Pay ₹${PRICE_PER_SLOT} 🏏`;
            }
        }
    }

    function formatDate(dateString) {
        const opts = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
        return new Date(dateString).toLocaleDateString('en-IN', opts);
    }

    if (bookingForm) {
        bookingForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!payBtn) { window.location.href = '/login'; return; }
            if (selectedSlots.length === 0) { showToast('Select a slot!', 'error'); return; }

            payBtn.disabled = true;
            payBtn.textContent = '⏳ Processing...';

            fetch('/api/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: datePicker.value, times: selectedSlots })
            })
            .then(res => res.json())
            .then(data => {
                if (!data.success) {
                    showToast(data.error || 'Failed!', 'error');
                    payBtn.disabled = false;
                    return;
                }

                const options = {
                    key:         payBtn.dataset.key,
                    amount:      data.amount,
                    currency:    data.currency,
                    name:        "THE 'D' TURF",
                    description: `Booking for ${selectedSlots.length} slots`,
                    order_id:    data.order_id,
                    prefill: {
                        name:    data.user_name,
                        contact: data.user_phone, // YEH ZAROORI HAI UPI KE LIYE
                        email:   'test@example.com'
                    },
                    theme: { color: '#d11a2a' },
                    handler: function (response) {
                        fetch('/api/verify-payment', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                razorpay_order_id:   response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature:  response.razorpay_signature
                            })
                        })
                        .then(r => r.json())
                        .then(verifyData => {
                            if (verifyData.success) {
                                window.location.href = `/ticket/${verifyData.booking_id}`;
                            }
                        });
                    }
                };
                const rzp = new Razorpay(options);
                rzp.open();
            })
            .finally(() => {
                payBtn.disabled = false;
                payBtn.textContent = `Proceed to Pay ₹${selectedSlots.length * PRICE_PER_SLOT} 🏏`;
            });
        });
    }

    function showToast(message, type = 'success') {
        alert(message); // Mobile par alert zyada reliable hai testing ke liye
    }
});
