document.addEventListener('DOMContentLoaded', () => {
    // Splash screen
    const splash = document.getElementById('splash-screen');
    if (splash) setTimeout(() => { splash.style.opacity = '0'; setTimeout(() => splash.style.visibility = 'hidden', 800); }, 2000);

    const datePicker = document.getElementById('booking-date'), slotsGrid = document.getElementById('slots-grid');
    const summaryTime = document.getElementById('summary-time'), summaryPrice = document.getElementById('summary-price');
    const payBtn = document.getElementById('pay-btn'), bookingForm = document.getElementById('booking-form');

    let selectedSlots = [];
    const PRICE_PER_SLOT = 499;

    const today = new Date().toISOString().split('T')[0];
    if (datePicker) { datePicker.min = today; datePicker.value = today; renderSlots(today); }

    const availableSlots = ["06:00 AM", "07:00 AM", "08:00 AM", "09:00 AM", "10:00 AM", "04:00 PM", "05:00 PM", "06:00 PM", "07:00 PM", "08:00 PM", "09:00 PM", "10:00 PM"];

    if (datePicker) datePicker.addEventListener('change', (e) => { selectedSlots = []; updateSummary(); renderSlots(e.target.value); });

    function renderSlots(date) {
        slotsGrid.innerHTML = '<p>Loading slots...</p>';
        fetch(`/api/slots?date=${date}`).then(res => res.json()).then(data => {
            slotsGrid.innerHTML = '';
            const booked = data.booked_slots || [];
            availableSlots.forEach(time => {
                const isBooked = booked.includes(time);
                const slotEl = document.createElement('div');
                slotEl.className = `slot ${isBooked ? 'booked' : ''}`;
                slotEl.textContent = time;
                if (!isBooked) slotEl.addEventListener('click', () => {
                    slotEl.classList.toggle('selected');
                    if (slotEl.classList.contains('selected')) selectedSlots.push(time);
                    else selectedSlots = selectedSlots.filter(s => s !== time);
                    updateSummary();
                });
                slotsGrid.appendChild(slotEl);
            });
        });
    }

    function updateSummary() {
        const total = selectedSlots.length * PRICE_PER_SLOT;
        summaryTime.textContent = selectedSlots.length > 0 ? selectedSlots.sort().join(", ") : '-';
        summaryPrice.textContent = `₹${total || PRICE_PER_SLOT} ${selectedSlots.length > 0 ? '('+selectedSlots.length+' slots)' : '/ hr'}`;
        if (payBtn) { payBtn.disabled = selectedSlots.length === 0; payBtn.textContent = `Proceed to Pay ₹${total || PRICE_PER_SLOT} 🏏`; }
    }

    if (bookingForm) {
        bookingForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (selectedSlots.length === 0) return alert('Select a slot!');
            payBtn.disabled = true; payBtn.textContent = '⏳ Creating Order...';

            fetch('/api/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: datePicker.value, times: selectedSlots })
            })
            .then(res => res.json()).then(data => {
                if (!data.success) { alert(data.error); payBtn.disabled = false; return; }

                const options = {
                    key: payBtn.dataset.key,
                    amount: data.amount,
                    currency: "INR",
                    name: "THE 'D' TURF",
                    description: `Book ${selectedSlots.length} slots`,
                    image: "/static/img/logo.jpg",
                    order_id: data.order_id,
                    prefill: { name: data.user_name, contact: data.user_phone },
                    theme: { color: "#d11a2a" },
                    // FORCE UPI CONFIG
                    config: {
                        display: {
                            blocks: {
                                upi: {
                                    name: 'Pay via Google Pay / PhonePe / Paytm',
                                    instruments: [{ method: 'upi' }]
                                }
                            },
                            sequence: ['block.upi'],
                            preferences: { show_default_blocks: true }
                        }
                    },
                    handler: function (response) {
                        fetch('/api/verify-payment', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature
                            })
                        }).then(r => r.json()).then(v => { if (v.success) window.location.href = `/ticket/${v.booking_id}`; else alert('Verification Failed!'); });
                    },
                    modal: { ondismiss: function() { payBtn.disabled = false; } }
                };
                new Razorpay(options).open();
            });
        });
    }
});
