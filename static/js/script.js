document.addEventListener('DOMContentLoaded', () => {
    const splash = document.getElementById('splash-screen');
    if (splash) setTimeout(() => { splash.style.opacity = '0'; setTimeout(() => splash.style.visibility = 'hidden', 800); }, 2000);

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

    function getPriceData(dateStr) {
        const date = new Date(dateStr);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const base = isWeekend ? 1200 : 1000;
        const diffDays = Math.ceil(Math.abs(date - LAUNCH_DATE) / (1000 * 60 * 60 * 24)) + 1;
        
        if (diffDays <= 10) return { original: base, final: base * 0.5, discount: base * 0.5, label: "50% Opening Off" };
        return { original: base, final: base, discount: 0, label: "" };
    }

    function renderSlots(date) {
        morningGrid.innerHTML = eveningGrid.innerHTML = '<p>Loading...</p>';
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
        const price = getPriceData(datePicker.value).final;
        slotEl.innerHTML = `${time}<br><small>₹${price}</small>`;
        if (!isBooked) slotEl.onclick = () => {
            slotEl.classList.toggle('selected');
            if (slotEl.classList.contains('selected')) selectedSlots.push(time);
            else selectedSlots = selectedSlots.filter(s => s !== time);
            updateSummary();
        };
        container.appendChild(slotEl);
    }

    function updateSummary() {
        const data = getPriceData(datePicker.value);
        const totalOrig = selectedSlots.length * data.original;
        const totalFinal = selectedSlots.length * data.final;
        const totalDisc = selectedSlots.length * data.discount;

        summaryTime.textContent = selectedSlots.length > 0 ? selectedSlots.sort().join(", ") : '-';
        
        if (selectedSlots.length > 0) {
            summaryPrice.innerHTML = `
                <span style="text-decoration: line-through; color: #777; font-size: 0.9rem;">₹${totalOrig}</span> 
                <span style="color: #27ae60; font-size: 0.9rem;">-${totalDisc} (${data.label})</span><br>
                <strong style="font-size: 1.3rem;">Total: ₹${totalFinal}</strong>
            `;
        } else {
            summaryPrice.textContent = `₹${data.final}`;
        }

        if (payBtn) {
            payBtn.disabled = selectedSlots.length === 0;
            payBtn.textContent = `Pay ₹${totalFinal || data.final} 🏏`;
        }
    }

    if (bookingForm) {
        bookingForm.onsubmit = (e) => {
            e.preventDefault();
            payBtn.disabled = true; payBtn.textContent = '⏳ Processing...';
            fetch('/api/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: datePicker.value, times: selectedSlots })
            }).then(res => res.json()).then(data => {
                if (!data.success) { alert(data.error); payBtn.disabled = false; return; }
                const options = {
                    key: payBtn.dataset.key, amount: data.amount, currency: "INR", name: "THE 'D' TURF", order_id: data.order_id,
                    prefill: { name: data.user_name, contact: data.user_phone }, theme: { color: "#d11a2a" },
                    handler: function (response) {
                        fetch('/api/verify-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(response) })
                        .then(r => r.json()).then(v => { if (v.success) window.location.href = `/ticket/${v.booking_id}`; });
                    },
                    modal: { ondismiss: function() { payBtn.disabled = false; } }
                };
                new Razorpay(options).open();
            });
        };
    }
});
