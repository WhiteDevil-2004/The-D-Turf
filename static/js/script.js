document.addEventListener('DOMContentLoaded', () => {

    // ── Splash Screen ────────────────────────────────────────────────────────
    const splashScreen = document.getElementById('splash-screen');
    if (splashScreen) {
        setTimeout(() => {
            splashScreen.style.opacity = '0';
            setTimeout(() => { splashScreen.style.visibility = 'hidden'; }, 800);
        }, 2000);
    }

    // ── DOM References ───────────────────────────────────────────────────────
    const datePicker  = document.getElementById('booking-date');
    const slotsGrid   = document.getElementById('slots-grid');
    const summaryDate = document.getElementById('summary-date');
    const summaryTime = document.getElementById('summary-time');
    const summaryPrice = document.getElementById('summary-price');
    const payBtn      = document.getElementById('pay-btn');
    const bookingForm = document.getElementById('booking-form');

    let selectedSlots = []; // Multi-selection array
    const PRICE_PER_SLOT = 499;

    // ── Date setup ───────────────────────────────────────────────────────────
    const today = new Date().toISOString().split('T')[0];
    if (datePicker) {
        datePicker.min = today;
        datePicker.value = today; // Set default to today
        renderSlots(today);
    }

    // ── Available Time Slots ─────────────────────────────────────────────────
    const availableSlots = [
        "06:00 AM", "07:00 AM", "08:00 AM", "09:00 AM", "10:00 AM",
        "04:00 PM", "05:00 PM", "06:00 PM", "07:00 PM", "08:00 PM",
        "09:00 PM", "10:00 PM"
    ];

    // ── Date Change ──────────────────────────────────────────────────────────
    if (datePicker) {
        datePicker.addEventListener('change', (e) => {
            summaryDate.textContent = formatDate(e.target.value);
            selectedSlots = []; // Reset on date change
            updateSummary();
            renderSlots(e.target.value);
        });
    }

    // ── Render Slots ─────────────────────────────────────────────────────────
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
                slotsGrid.innerHTML = '<p style="color:red">❌ Failed to load slots. Please try again.</p>';
            });
    }

    // ── Toggle Slot Selection ────────────────────────────────────────────────
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

    // ── Update Summary Details ───────────────────────────────────────────────
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

    // ── Format Date ──────────────────────────────────────────────────────────
    function formatDate(dateString) {
        const opts = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
        return new Date(dateString).toLocaleDateString('en-IN', opts);
    }

    // ── Form Submit → Razorpay Flow ──────────────────────────────────────────
    if (bookingForm) {
        bookingForm.addEventListener('submit', (e) => {
            e.preventDefault();

            if (!payBtn) {
                window.location.href = '/login';
                return;
            }

            if (!datePicker.value || selectedSlots.length === 0) {
                showToast('Please select at least one time slot!', 'error');
                return;
            }

            payBtn.disabled = true;
            payBtn.textContent = '⏳ Creating Order...';

            // Step 1: Create Razorpay order on backend for multiple slots
            fetch('/api/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: datePicker.value, times: selectedSlots })
            })
            .then(res => res.json())
            .then(data => {
                if (!data.success) {
                    showToast(data.error || 'Order creation failed!', 'error');
                    payBtn.disabled = false;
                    updateSummary();
                    return;
                }

                const options = {
                    key:         payBtn.dataset.key,
                    amount:      data.amount,
                    currency:    data.currency,
                    name:        "THE 'D' TURF",
                    description: `${selectedSlots.length} Slots on ${datePicker.value}`,
                    image:       '/static/img/logo.jpg',
                    order_id:    data.order_id,
                    prefill: {
                        name:    data.user_name,
                        contact: data.user_phone,
                        method:  'upi'
                    },
                    theme: { color: '#d11a2a' },
                    config: {
                        display: {
                            hide: [{ method: 'paylater' }],
                            preferences: { show_default_blocks: true }
                        }
                    },
                    handler: function (response) {
                        payBtn.textContent = '✅ Verifying...';
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
                                showToast('🎉 All Slots Booked Successfully!', 'success');
                                setTimeout(() => {
                                    window.location.href = `/ticket/${verifyData.booking_id}`;
                                }, 1500);
                            } else {
                                showToast('⚠️ Verification failed. Contact support.', 'error');
                            }
                        });
                    },
                    modal: {
                        ondismiss: function () {
                            fetch('/api/payment-failed', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ razorpay_order_id: data.order_id })
                            });
                            showToast('Payment cancelled.', 'error');
                            payBtn.disabled = false;
                            updateSummary();
                        }
                    }
                };

                const rzp = new Razorpay(options);
                rzp.open();
            })
            .catch(() => {
                showToast('❌ Network error.', 'error');
                payBtn.disabled = false;
                updateSummary();
            });
        });
    }

    function showToast(message, type = 'success') {
        const existing = document.querySelector('.toast-notification');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.textContent = message;
        toast.style.cssText = `position:fixed;bottom:2rem;right:2rem;background:${type==='success'?'#1a7a4a':'#8b1a1a'};color:white;padding:1rem 1.5rem;border-radius:12px;font-weight:600;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.4);`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }
});
