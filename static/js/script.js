document.addEventListener('DOMContentLoaded', () => {
    // 💎 PREMIUM SPLASH HANDLER
    const splash = document.getElementById('splash-screen');
    if (splash) {
        setTimeout(() => {
            splash.style.opacity = '0';
            setTimeout(() => {
                splash.style.visibility = 'hidden';
            }, 1000);
        }, 3500);
    }

    const datePicker = document.getElementById('booking-date');
    const morningGrid = document.getElementById('morning-slots'), eveningGrid = document.getElementById('evening-slots');
    const summaryTime = document.getElementById('summary-time'), summaryPrice = document.getElementById('summary-price');
    const payBtn = document.getElementById('pay-btn'), bookingForm = document.getElementById('booking-form');

    let selectedSlots = [];
    const LAUNCH_DATE = new Date("2026-05-02");

    const today = new Date().toISOString().split('T')[0];
    if (datePicker) { datePicker.min = today; datePicker.value = today; renderSlots(today); }

    const morningTimes = ["06:00 AM", "07:00 AM", "08:00 AM", "09:00 AM", "10:00 AM", "11:00 AM", "12:00 PM"];
    const eveningTimes = ["04:00 PM", "05:00 PM", "06:00 PM", "07:00 PM", "08:00 PM", "09:00 PM", "10:00 PM", "11:00 PM"];

    if (datePicker) datePicker.addEventListener('change', (e) => { selectedSlots = []; updateSummary(); renderSlots(e.target.value); });

    // 💰 SMART PRICING FUNCTION (As per User Image)
    function getPriceData(dateStr, timeStr) {
        const date = new Date(dateStr);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;

        // Determine if morning or evening
        const isMorning = morningTimes.includes(timeStr);

        let basePrice = 0;
        if (isMorning) {
            basePrice = isWeekend ? 999 : 799;
        } else {
            basePrice = isWeekend ? 1199 : 999;
        }

        const diffDays = Math.ceil(Math.abs(date - LAUNCH_DATE) / (1000 * 60 * 60 * 24)) + 1;

        let finalPrice = basePrice;
        let discountLabel = "";
        let discountAmount = 0;

        if (diffDays <= 7) {
            finalPrice = basePrice * 0.5;
            discountAmount = basePrice * 0.5;
            discountLabel = "50% OFF (First 7 Days)";
        } else if (diffDays <= 15) {
            finalPrice = basePrice * 0.75;
            discountAmount = basePrice * 0.25;
            discountLabel = "25% OFF (Up to 15 Days)";
        }

        return { orig: basePrice, final: finalPrice, disc: discountAmount, label: discountLabel };
    }

    function renderSlots(date) {
        morningGrid.innerHTML = eveningGrid.innerHTML = '<div class="loader">Loading...</div>';
        fetch(`/api/slots?date=${date}`).then(res => res.json()).then(data => {
            morningGrid.innerHTML = eveningGrid.innerHTML = '';
            const booked = data.booked_slots || [];
            morningTimes.forEach(t => createSlot(t, booked, morningGrid));
            eveningTimes.forEach(t => createSlot(t, booked, eveningGrid));
        });
    }

    function createSlot(time, booked, container) {
        const isBooked = booked.includes(time);
        const slotEl = document.createElement('div');
        slotEl.className = `slot ${isBooked ? 'booked' : ''}`;

        const priceData = getPriceData(datePicker.value, time);
        slotEl.innerHTML = `${time}<br><small style="color:var(--text-muted)">₹${priceData.final.toFixed(2)}</small>`;

        if (!isBooked) slotEl.onclick = () => {
            slotEl.classList.toggle('selected');
            if (slotEl.classList.contains('selected')) {
                selectedSlots.push({ time: time, price: priceData.final, orig: priceData.orig });
            } else {
                selectedSlots = selectedSlots.filter(s => s.time !== time);
            }
            updateSummary();
        };
        container.appendChild(slotEl);
    }

    function updateSummary() {
        let totalFinal = 0;
        let totalOrig = 0;
        selectedSlots.forEach(s => {
            totalFinal += s.price;
            totalOrig += s.orig;
        });

        summaryTime.textContent = selectedSlots.length > 0 ? selectedSlots.map(s => s.time).sort().join(", ") : '-';

        if (selectedSlots.length > 0) {
            const savings = totalOrig - totalFinal;
            summaryPrice.innerHTML = `
                <span style="text-decoration:line-through;color:#777;font-size:0.85rem">₹${totalOrig.toFixed(2)}</span> 
                <span style="color:#27ae60;font-size:0.85rem">-${savings.toFixed(2)} Savings</span><br>
                <strong style="font-size:1.4rem;color:white">Total: ₹${totalFinal.toFixed(2)}</strong>
            `;
        } else {
            summaryPrice.textContent = `₹0.00`;
        }

        if (payBtn) {
            payBtn.disabled = selectedSlots.length === 0;
            payBtn.textContent = selectedSlots.length > 0 ? `Pay ₹${totalFinal.toFixed(2)} 🏏` : "Select Slots to Book";
        }
    }

    if (bookingForm) {
        bookingForm.onsubmit = (e) => {
            e.preventDefault();
            const timesOnly = selectedSlots.map(s => s.time);
            payBtn.disabled = true; payBtn.textContent = '⏳ Creating Order...';
            fetch('/api/create-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: datePicker.value, times: timesOnly }) })
                .then(res => res.json()).then(data => {
                    if (!data.success) { alert(data.error); payBtn.disabled = false; return; }
                    const options = {
                        key: payBtn.dataset.key, amount: data.amount, currency: "INR", name: "THE 'D' TURF", order_id: data.order_id,
                        prefill: { name: data.user_name, contact: data.user_phone }, theme: { color: "#d11a2a" },
                        handler: function (response) {
                            fetch('/api/verify-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(response) })
                                .then(r => r.json()).then(v => { if (v.success) window.location.href = `/ticket/${v.booking_id}`; });
                        },
                        modal: { ondismiss: function () { payBtn.disabled = false; } }
                    };
                    new Razorpay(options).open();
                });
        };
    }
});
