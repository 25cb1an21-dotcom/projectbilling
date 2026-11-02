(() => {
    const role = document.body.dataset.role;
    const user = window.requireRole([role]);
    if (!user) return;

    const data = window.RestaurantData;
    const content = document.querySelector('#dashboard-content');
    const welcomeText = {
        owner: 'Your restaurant at a glance.',
        cashier: 'Keep billing quick, clear, and accurate.',
        waiter: 'Manage tables and keep guests updated.',
        chef: 'Your kitchen queue, live and ready.'
    };
    const roleLabels = { owner: 'Owner', cashier: 'Cashier', waiter: 'Waiter', chef: 'Chef' };
    const navByRole = {
        owner: [
            ['overview', '📊', 'Overview'],
            ['staff', '👥', 'Staff'],
            ['menu', '🍛', 'Menu'],
            ['contact', '📍', 'Contact']
        ],
        cashier: [['billing', '🧾', 'Billing']],
        waiter: [['tables', '🪑', 'Tables'], ['ready-orders', '🔔', 'Ready']],
        chef: [['kitchen', '👨‍🍳', 'Kitchen']]
    };
    let activeAnchor = navByRole[role][0][0];
    let waiterDraft = [];
    let waiterFormState = {};
    let splitDraft = null;
    let printBillHTML = '';
    let splitPrintHTML = '';
    let toastTimer = 0;

    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
    const money = value => `₹${Number(value || 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    })}`;
    const menuItems = () => data.loadMenu();
    const allOrders = () => data.loadOrders();
    const openOrders = () => allOrders().filter(order => order.status === 'new');
    const lookupMenu = id => menuItems().find(item => String(item.id) === String(id));

    document.querySelector('#user-name').textContent = user.name;
    document.querySelector('#role-badge').textContent = roleLabels[role];
    document.querySelector('[data-logout]').addEventListener('click', window.logout);

    function showToast(message) {
        let toast = document.querySelector('#dashboard-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'dashboard-toast';
            toast.className = 'dashboard-toast';
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');
            Object.assign(toast.style, {
                position: 'fixed', zIndex: '15', right: '16px', bottom: '82px',
                border: '1px solid var(--accent)', borderRadius: '9px', padding: '12px 16px',
                background: 'var(--panel-raised)', color: 'var(--ink)', boxShadow: '0 10px 28px #0006'
            });
            document.body.append(toast);
        }
        toast.textContent = message;
        clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.remove(), 2600);
    }

    function persist(callback, successMessage) {
        try {
            callback();
            if (successMessage) showToast(successMessage);
            return true;
        } catch (error) {
            console.error('Could not save dashboard changes.', error);
            showToast('Could not save changes. Check browser storage.');
            return false;
        }
    }

    function setupNavigation() {
        const nav = document.querySelector('#dashboard-nav');
        const mobileNav = document.querySelector('#mobile-tabs');
        const links = navByRole[role].map(([id, icon, label]) => {
            const markup = `<a class="dashboard-nav-link" href="#${id}" data-anchor="${id}"><span aria-hidden="true">${icon}</span><span>${label}</span></a>`;
            return markup;
        }).join('');
        const mobileLinks = navByRole[role].map(([id, icon, label]) =>
            `<a class="mobile-tab-link" href="#${id}" data-anchor="${id}"><span aria-hidden="true">${icon}</span><span>${label}</span></a>`
        ).join('');
        nav.innerHTML = links + (role === 'owner'
            ? '<a class="dashboard-nav-link" href="order.html#/admin"><span aria-hidden="true">🧾</span><span>Full billing portal</span></a>'
            : '');
        mobileNav.innerHTML = mobileLinks + (role === 'owner'
            ? '<a class="mobile-tab-link" href="order.html#/admin"><span aria-hidden="true">🧾</span><span>Billing</span></a>'
            : '');
        document.querySelectorAll('[data-anchor]').forEach(link => {
            link.addEventListener('click', () => setActiveAnchor(link.dataset.anchor));
        });
        setActiveAnchor(activeAnchor);
    }

    function setActiveAnchor(anchor) {
        activeAnchor = anchor;
        document.querySelectorAll('[data-anchor]').forEach(link => {
            if (link.dataset.anchor === anchor) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });
    }

    function pageHeader() {
        return `<div class="dashboard-welcome"><p class="welcome-kicker">${esc(roleLabels[role])} workspace</p><h1>Welcome back, ${esc(role === 'chef' ? `Chef ${user.name}` : user.name)}</h1><p>${esc(welcomeText[role])}</p></div>`;
    }

    function dateIsToday(timestamp) {
        return timestamp && new Date(timestamp).toDateString() === new Date().toDateString();
    }

    function ownerOverview() {
        const orders = allOrders();
        const paid = orders.filter(order => order.status === 'paid' && order.bill);
        const todayPaid = paid.filter(order => dateIsToday(order.bill.paidAt || order.time));
        const sales = todayPaid.reduce((total, order) => total + Number(order.bill.tot || 0), 0);
        const dishes = new Map();
        paid.forEach(order => order.items.forEach(item => {
            dishes.set(item.n, (dishes.get(item.n) || 0) + Number(item.q || 0));
        }));
        const topDish = [...dishes.entries()].sort((a, b) => b[1] - a[1])[0];
        const days = Array.from({ length: 7 }, (_, index) => {
            const day = new Date();
            day.setHours(0, 0, 0, 0);
            day.setDate(day.getDate() - (6 - index));
            const amount = paid.filter(order => new Date(order.bill.paidAt || order.time).toDateString() === day.toDateString())
                .reduce((sum, order) => sum + Number(order.bill.tot || 0), 0);
            return { label: day.toLocaleDateString('en-IN', { weekday: 'short' }), amount };
        });
        const max = Math.max(1, ...days.map(day => day.amount));
        return `<section class="dashboard-section" id="overview">
            <h2>Sales overview</h2>
            <div class="dashboard-grid">
                <article class="summary-card"><span class="summary-label">Today's sales</span><strong class="summary-value">${money(sales)}</strong><span class="summary-foot">${todayPaid.length} paid orders</span></article>
                <article class="summary-card"><span class="summary-label">Open orders</span><strong class="summary-value">${openOrders().length}</strong><span class="summary-foot">Awaiting payment</span></article>
                <article class="summary-card"><span class="summary-label">Top dish</span><strong class="summary-value">${esc(topDish?.[0] || 'No sales yet')}</strong><span class="summary-foot">${topDish ? `${topDish[1]} sold` : 'Dish sales will appear here'}</span></article>
            </div>
            <article class="dashboard-card" style="margin-top:14px"><h3>Paid sales · last 7 days</h3><div class="sales-chart" role="img" aria-label="Bar chart of sales for the last seven days">${days.map(day => `<div class="sales-chart-column"><span class="sales-chart-value">${day.amount ? esc(money(day.amount)) : '—'}</span><div class="sales-chart-bar" style="height:${Math.max(4, day.amount / max * 100)}%" title="${esc(money(day.amount))}"></div><span class="sales-chart-label">${esc(day.label)}</span></div>`).join('')}</div></article>
            <p><a class="dashboard-action" href="order.html#/admin">Open full billing and kitchen dashboard</a></p>
        </section>`;
    }

    function ownerStaff() {
        const staff = data.loadStaff();
        return `<section class="dashboard-section" id="staff"><h2>Staff accounts</h2>
            <article class="dashboard-card"><form class="dashboard-form" id="staff-form">
                <label>Name<input name="name" autocomplete="name" required></label>
                <label>Username<input name="username" autocomplete="off" required></label>
                <label>Password<input name="password" type="password" autocomplete="new-password" required></label>
                <label>Role<select name="role" required><option value="owner">Owner</option><option value="cashier">Cashier</option><option value="waiter">Waiter</option><option value="chef">Chef</option></select></label>
                <button type="submit">Add staff</button>
            </form><p class="dashboard-meta">Demo credentials and staff passwords are stored in this browser; this is not production authentication.</p></article>
            <article class="dashboard-card dashboard-table-wrap" style="margin-top:14px"><table class="dashboard-table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Action</th></tr></thead><tbody>
            ${staff.length ? staff.map(member => `<tr><td>${esc(member.name)}</td><td>${esc(member.username)}</td><td>${esc(member.role)}</td><td><button class="dashboard-action danger small" type="button" data-action="remove-staff" data-username="${esc(member.username)}">Remove</button></td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">No staff accounts added yet.</td></tr>'}
            </tbody></table></article></section>`;
    }

    function ownerMenu() {
        const menu = menuItems();
        const ratings = data.loadRatings();
        return `<section class="dashboard-section" id="menu"><h2>Menu management</h2>
            <article class="dashboard-card"><form class="dashboard-form" id="menu-form">
                <input type="hidden" name="id">
                <label>Dish name<input name="name" required></label>
                <label>Category<input name="category" required></label>
                <label>Price (₹)<input name="price" type="number" min="0.01" step="0.01" required></label>
                <label>Image URL<input name="image" type="url" placeholder="https://..."></label>
                <label>Fallback emoji<input name="emoji" maxlength="4" value="🍽️"></label>
                <button type="submit" id="menu-submit">Add menu item</button><button type="button" class="dashboard-action secondary" id="menu-cancel" hidden>Cancel edit</button>
            </form></article>
            <div class="dashboard-grid" style="margin-top:14px">${menu.map(item => `<article class="dashboard-card menu-management-card">
                ${validImage(item.img) ? `<img class="dashboard-menu-image" src="${esc(validImage(item.img))}" alt="" loading="lazy">` : `<span class="menu-fallback" aria-hidden="true">${esc(item.e || '🍽️')}</span>`}
                <h3>${esc(item.n)}</h3><p class="dashboard-meta">${esc(item.c)} · ${money(item.p)}</p>
                ${ratingSummary(ratings[String(item.id)])}
                <div class="dashboard-row"><button type="button" class="dashboard-action small" data-action="edit-menu" data-id="${esc(item.id)}">Edit</button><button type="button" class="dashboard-action danger small" data-action="delete-menu" data-id="${esc(item.id)}">Delete</button></div>
            </article>`).join('') || '<p class="empty-state">No menu items. Add one above.</p>'}</div></section>`;
    }

    function ownerContact() {
        const contact = data.loadContact();
        return `<section class="dashboard-section" id="contact"><h2>Restaurant contact details</h2>
            <article class="dashboard-card"><form class="dashboard-form" id="contact-form">
                <label>Online / delivery phone<input name="onlinePhone" type="tel" value="${esc(contact.online?.phone || '')}" required></label>
                <label>Online hours (HH:MM-HH:MM)<input name="onlineHours" pattern="\\d{1,2}:\\d{2}-\\d{1,2}:\\d{2}" value="${esc(contact.online?.hours || '10:00-22:00')}" required></label>
                <label>Dine-in phone<input name="offlinePhone" type="tel" value="${esc(contact.offline?.phone || '')}" required></label>
                <label>Dine-in hours (HH:MM-HH:MM)<input name="offlineHours" pattern="\\d{1,2}:\\d{2}-\\d{1,2}:\\d{2}" value="${esc(contact.offline?.hours || '11:00-20:00')}" required></label>
                <label>Email<input name="email" type="email" value="${esc(contact.email || '')}" required></label>
                <label>Full address<textarea name="address" required>${esc(contact.address || '')}</textarea></label>
                <button type="submit">Save contact details</button>
            </form></article></section>`;
    }

    function cashierBilling() {
        const orders = openOrders();
        const menu = menuItems();
        const set = readSettings();
        const splitBills = data.loadSplitBills();
        return `<section class="dashboard-section" id="billing"><h2>Open bills</h2>
            ${orders.length ? `<div class="dashboard-grid">${orders.map(order => {
                const items = Array.isArray(order.items) ? order.items : [];
                const totals = totalsFor(order);
                const subtotal = totals.sub;
                const discountRate = Math.max(0, Math.min(100, Number(order.discountPercent || 0)));
                const discount = totals.discount;
                const gstRate = totals.rate;
                const gst = totals.gst;
                const serviceCharge = totals.serviceCharge;
                const total = totals.total;
                const splitRecord = splitBills.find(record => String(record.orderId) === String(order.id));
                const editLocked = Boolean(splitRecord || splitDraft?.orderId === String(order.id));
                return `<article class="dashboard-card cashier-order" data-order-card="${esc(order.id)}">
                    <div class="dashboard-row"><h3>Order #${esc(order.id)}</h3><span class="status-pill ${esc(order.stage || 'pending')}">${esc(stageLabel(order.stage))}</span></div>
                    <p class="dashboard-meta">Table ${esc(order.table)}${order.name ? ` · ${esc(order.name)}` : ''}</p>
                    <div class="dashboard-items">${items.map((item, index) => `<div class="dashboard-order-item"><span>${esc(item.n)} · ${money(item.p)}</span><button type="button" ${editLocked ? 'disabled' : ''} data-action="qty-minus" data-order="${esc(order.id)}" data-index="${index}" aria-label="Remove one ${esc(item.n)}">−</button><span>${esc(item.q)}</span><button type="button" ${editLocked ? 'disabled' : ''} data-action="qty-plus" data-order="${esc(order.id)}" data-index="${index}" aria-label="Add one ${esc(item.n)}">+</button></div>`).join('') || '<span class="empty-state">No bill items.</span>'}</div>
                    <div class="dashboard-form"><label>Add a menu item<select ${editLocked ? 'disabled' : ''} data-add-item="${esc(order.id)}">${menu.map(item => `<option value="${esc(item.id)}">${esc(item.n)} · ${money(item.p)}</option>`).join('')}</select></label><button type="button" ${editLocked ? 'disabled' : ''} class="dashboard-action small" data-action="add-bill-item" data-order="${esc(order.id)}">Add item</button></div>
                    <label class="dashboard-field" style="margin-top:12px">Discount (%)<input type="number" min="0" max="100" step="0.5" value="${discountRate}" ${editLocked ? 'disabled' : ''} data-discount="${esc(order.id)}"></label>
                    <label class="dashboard-field">Service charge (₹)<input type="number" min="0" step="0.01" value="${Number(order.serviceCharge || 0).toFixed(2)}" ${editLocked ? 'disabled' : ''} data-service-charge="${esc(order.id)}"></label>
                    <div class="dashboard-meta" style="margin-top:12px">Subtotal ${money(subtotal)} · Discount ${money(discount)} · Service ${money(serviceCharge)} · GST ${gstRate}% ${money(gst)}</div>
                    <div class="dashboard-row" style="margin-top:8px"><strong>Total ${money(total)}</strong>${splitRecord ? '<span class="status-pill pending">Split in progress</span>' : `<select aria-label="Payment method for order ${esc(order.id)}" data-payment="${esc(order.id)}"><option value="Cash">Cash</option><option value="UPI" ${order.paymentMethod === 'UPI' ? 'selected' : ''}>UPI</option><option value="Card" ${order.paymentMethod === 'Card' ? 'selected' : ''}>Card</option></select>`}</div>
                    <div class="dashboard-row" style="margin-top:12px"><button type="button" class="dashboard-action secondary small" data-action="print-bill" data-order="${esc(order.id)}">Generate / Print bill</button>${splitRecord ? `<button type="button" class="dashboard-action small" data-action="review-split" data-split-id="${esc(splitRecord.id)}">View split invoices</button>` : `<button type="button" class="dashboard-action secondary small" data-action="start-split" data-order="${esc(order.id)}">Split bill</button><button type="button" class="dashboard-action small" data-action="mark-paid" data-order="${esc(order.id)}">Mark as Paid</button>`}</div>
                </article>`;
            }).join('')}</div>` : '<p class="empty-state">There are no open orders right now.</p>'}
            ${splitDraft ? splitEditorHTML(splitDraft, set) : ''}
            ${splitRecordsHTML(splitBills)}
            <section class="bill-print" id="bill-print" aria-label="Bill print preview">${printBillHTML}</section>
            <section class="split-print" id="split-print" aria-label="Individual split invoice print preview">${splitPrintHTML}</section>
        </section>`;
    }

    function moneyPaise(amount) {
        return money(window.RestaurantSplitBill.fromPaise(amount));
    }

    function splitEditorHTML(draft, settings) {
        const order = findOrder(draft.orderId);
        if (!order) return '<article class="dashboard-card split-editor"><p role="alert">This order is no longer available.</p></article>';
        let bill;
        try {
            bill = window.RestaurantSplitBill.calculateTotals(order, order.discountPercent || 0, settings.gst || 0);
        } catch (error) {
            return `<article class="dashboard-card split-editor"><p role="alert">${esc(error.message)}</p></article>`;
        }
        const built = window.RestaurantSplitBill.buildSplit(order, draft, bill);
        const methods = [
            ['equal', 'Equal Split'],
            ['items', 'Item Split'],
            ['custom', 'Custom Amount']
        ];
        let allocationEditor = '';
        if (draft.method === 'items') {
            allocationEditor = `<div class="split-allocation-table" style="--split-customer-count:${draft.count}"><div class="split-allocation-row split-allocation-head"><span>Food item</span>${draft.labels.map((_, index) => `<span>Customer ${index + 1}</span>`).join('')}</div>
                ${bill.itemLines.map((item, lineIndex) => `<div class="split-allocation-row"><span>${esc(item.name)}<small>${item.quantity} ordered · ${moneyPaise(item.pricePaise)} each</small></span>${draft.labels.map((_, customerIndex) => `<label class="split-quantity"><span class="sr-only">${esc(item.name)} quantity for customer ${customerIndex + 1}</span><input type="number" min="0" max="${item.quantity}" step="1" value="${Number(draft.itemAllocations[lineIndex]?.[customerIndex] || 0)}" data-split-item="${lineIndex}" data-customer="${customerIndex}" aria-label="${esc(item.name)} quantity for customer ${customerIndex + 1}"></label>`).join('')}</div>`).join('')}</div>`;
        } else if (draft.method === 'custom') {
            allocationEditor = `<div class="split-custom-amounts">${draft.labels.map((_, index) => `<label>Customer ${index + 1} amount<input type="number" min="0.01" step="0.01" value="${esc(draft.customAmounts[index] ?? '')}" data-split-amount="${index}" inputmode="decimal"></label>`).join('')}</div>
                <label class="split-balance-choice"><input type="checkbox" data-record-balance ${draft.recordRemainder ? 'checked' : ''}> Explicitly record any remaining balance as its own unpaid invoice</label>`;
        }
        let previews = '';
        if (built.invoices?.length) {
            previews = `<div class="split-preview-grid">${built.invoices.map((invoice, index) => `<article class="split-preview-card">
                <h4>${esc(invoice.customerLabel)}</h4>
                ${invoice.lines.length ? `<ul>${invoice.lines.map(line => `<li>${line.quantity} × ${esc(line.name)} · ${moneyPaise(line.pricePaise * line.quantity)}</li>`).join('')}</ul>` : '<p class="dashboard-meta">Allocated share of the original bill</p>'}
                <p>Subtotal ${moneyPaise(invoice.subtotalPaise)} · Discount −${moneyPaise(invoice.discountPaise)}</p>
                ${invoice.serviceChargePaise ? `<p>Service charge ${moneyPaise(invoice.serviceChargePaise)}</p>` : ''}
                <p>Tax ${moneyPaise(invoice.taxPaise)}</p><strong>${moneyPaise(invoice.totalPaise)}</strong>
                ${invoice.balanceInvoice ? '<span class="status-pill pending">Unpaid balance</span>' : `<span class="dashboard-meta">Invoice ${index + 1}</span>`}
            </article>`).join('')}</div>`;
        } else if (draft.method === 'items') {
            previews = `<div class="split-preview-grid">${draft.labels.map((_, customerIndex) => {
                const lines = bill.itemLines.map((line, lineIndex) => ({
                    name: line.name,
                    quantity: Number(draft.itemAllocations[lineIndex]?.[customerIndex] || 0),
                    pricePaise: line.pricePaise
                })).filter(line => line.quantity > 0);
                const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.pricePaise, 0);
                return `<article class="split-preview-card"><h4>Customer ${customerIndex + 1}</h4>${lines.length
                    ? `<ul>${lines.map(line => `<li>${line.quantity} × ${esc(line.name)}</li>`).join('')}</ul>`
                    : '<p class="dashboard-meta">No items assigned yet.</p>'}
                    <p>Assigned subtotal ${moneyPaise(subtotal)}</p><span class="dashboard-meta">Final tax and discount preview appears when every quantity is assigned.</span></article>`;
            }).join('')}</div>`;
        } else {
            previews = `<div class="split-preview-grid">${draft.labels.map((_, index) => `<article class="split-preview-card"><h4>Customer ${index + 1}</h4><strong>${money(Number(draft.customAmounts[index] || 0))}</strong></article>`).join('')}</div>`;
        }
        return `<article class="dashboard-card split-editor" id="split-editor">
            <div class="dashboard-row"><div><p class="welcome-kicker">Order #${esc(order.id)}</p><h3>Split this bill</h3></div><button type="button" class="dashboard-action secondary small" data-action="cancel-split">Cancel</button></div>
            <p class="dashboard-meta">Original subtotal ${moneyPaise(bill.subtotalPaise)} · Discount −${moneyPaise(bill.discountPaise)} · Tax ${moneyPaise(bill.taxPaise)} · Service charge ${moneyPaise(bill.serviceChargePaise)} · <strong>Total ${moneyPaise(bill.totalPaise)}</strong></p>
            <div class="split-method-tabs" role="group" aria-label="Bill split method">${methods.map(([method, label]) => `<button type="button" class="dashboard-action small ${draft.method === method ? '' : 'secondary'}" data-action="split-method" data-method="${method}" aria-pressed="${draft.method === method}">${label}</button>`).join('')}</div>
            <label class="dashboard-field split-customer-count">Number of customers<input type="number" min="2" max="12" step="1" value="${draft.count}" data-split-count></label>
            ${allocationEditor}
            <h4 class="split-preview-heading">Live customer bill preview</h4>${previews}
            ${built.error ? `<p class="split-validation-error" role="alert">${esc(built.error)}</p>` : ''}
            <button type="button" class="dashboard-action split-finalize" data-action="finalize-split" ${built.ok ? '' : 'disabled'}>Finalize split invoices</button>
            <p class="dashboard-meta">Amounts use paise precision. Finalization stores one original-bill snapshot and creates separate invoices.</p>
        </article>`;
    }

    function splitRecordsHTML(records) {
        if (!records.length) return '<section class="dashboard-section" id="split-records"><h2>Split invoices</h2><p class="empty-state">No split bills have been created.</p></section>';
        return `<section class="dashboard-section" id="split-records"><h2>Split invoices</h2>
            <div class="split-record-list">${[...records].reverse().map(record => {
                const original = record.originalOrder || {};
                const totals = record.totals || {};
                const paid = record.invoices.filter(invoice => invoice.status === 'paid').length;
                const status = record.status === 'paid' ? 'Paid' : paid ? 'Partially paid' : 'Unpaid';
                return `<article class="dashboard-card split-record" id="split-${esc(record.id)}">
                    <div class="dashboard-row"><div><h3>Order #${esc(record.orderId)} · Table ${esc(original.table || '')}</h3><p class="dashboard-meta">Split invoice set ${esc(record.id)} · ${new Date(record.createdAt).toLocaleString('en-IN')}</p></div><span class="status-pill ${record.status === 'paid' ? 'ready' : 'pending'}">${status}</span></div>
                    <details class="split-original"><summary>Original combined bill · ${moneyPaise(totals.totalPaise)}</summary>
                        <p>Subtotal ${moneyPaise(totals.subtotalPaise)} · Discount −${moneyPaise(totals.discountPaise)} · Tax ${moneyPaise(totals.taxPaise)} · Service charge ${moneyPaise(totals.serviceChargePaise || 0)}</p>
                        <ul>${(original.items || []).map(item => `<li>${esc(item.q)} × ${esc(item.n)} · ${money(Number(item.p) * Number(item.q))}</li>`).join('')}</ul>
                    </details>
                    <div class="split-invoices">${record.invoices.map(invoice => `<article class="split-invoice">
                        <div class="dashboard-row"><h4>${esc(invoice.customerLabel)}</h4><span class="status-pill ${invoice.status === 'paid' ? 'ready' : 'pending'}">${invoice.status === 'paid' ? 'Paid' : 'Unpaid'}</span></div>
                        <p class="dashboard-meta">${esc(invoice.invoiceNo)}${invoice.balanceInvoice ? ' · Recorded remaining balance' : ''}</p>
                        ${invoice.lines?.length ? `<ul>${invoice.lines.map(line => `<li>${line.quantity} × ${esc(line.name)} · ${moneyPaise(line.pricePaise * line.quantity)}</li>`).join('')}</ul>` : ''}
                        <p>Subtotal ${moneyPaise(invoice.subtotalPaise)} · Discount −${moneyPaise(invoice.discountPaise)} · Tax ${moneyPaise(invoice.taxPaise)}${invoice.serviceChargePaise ? ` · Service ${moneyPaise(invoice.serviceChargePaise)}` : ''}</p>
                        <strong>${moneyPaise(invoice.totalPaise)}</strong>
                        ${invoice.status === 'paid' ? `<p class="dashboard-meta">Paid ${new Date(invoice.payments[0].paidAt).toLocaleString('en-IN')} via ${esc(invoice.payments[0].method)}</p>` : `<div class="split-pay-controls"><label>Payment method<select data-split-payment="${esc(record.id)}" data-invoice="${esc(invoice.invoiceNo)}"><option>Cash</option><option>UPI</option><option>Card</option></select></label><button type="button" class="dashboard-action small" data-action="pay-split-invoice" data-split-id="${esc(record.id)}" data-invoice="${esc(invoice.invoiceNo)}">Record payment</button></div>`}
                        <button type="button" class="dashboard-action secondary small" data-action="print-split-invoice" data-split-id="${esc(record.id)}" data-invoice="${esc(invoice.invoiceNo)}">Print individual invoice</button>
                    </article>`).join('')}</div>
                </article>`;
            }).join('')}</div>
        </section>`;
    }

    function createSplitDraft(order) {
        const settings = readSettings();
        const bill = window.RestaurantSplitBill.calculateTotals(order, order.discountPercent || 0, settings.gst || 0);
        const firstShare = Math.floor(bill.totalPaise / 2);
        const customAmounts = [firstShare, bill.totalPaise - firstShare].map(amount =>
            window.RestaurantSplitBill.fromPaise(amount).toFixed(2));
        return {
            orderId: String(order.id),
            method: 'equal',
            count: 2,
            labels: ['Customer 1', 'Customer 2'],
            itemAllocations: bill.itemLines.map(item => [item.quantity, 0]),
            customAmounts,
            recordRemainder: false
        };
    }

    function printInvoiceHTML(record, invoice) {
        const original = record.originalOrder || {};
        const totals = record.totals || {};
        return `<div class="print-bill-content"><h2>${esc(readSettings().name || 'Restaurant')}</h2>
            <p style="text-align:center">Split Tax Invoice · ${esc(invoice.invoiceNo)}</p><hr>
            <p>Original order #${esc(record.orderId)} · Table ${esc(original.table || '')}</p>
            <p>Customer: ${esc(invoice.customerLabel)} · ${new Date(record.createdAt).toLocaleString('en-IN')}</p><hr>
            ${invoice.lines?.length ? invoice.lines.map(line => `<p>${line.quantity} × ${esc(line.name)} · ${moneyPaise(line.pricePaise * line.quantity)}</p>`).join('') : '<p>Allocated share of original combined bill</p>'}
            <hr><p>Subtotal: ${moneyPaise(invoice.subtotalPaise)}</p><p>Discount: −${moneyPaise(invoice.discountPaise)}</p>
            ${invoice.serviceChargePaise ? `<p>Service charge: ${moneyPaise(invoice.serviceChargePaise)}</p>` : ''}
            <p>Tax: ${moneyPaise(invoice.taxPaise)}</p><hr><strong>Total: ${moneyPaise(invoice.totalPaise)}</strong>
            <p>Status: ${invoice.status === 'paid' ? `Paid via ${esc(invoice.payments[0]?.method || '')}` : 'Unpaid'}</p>
            <hr><p>Original combined bill: ${moneyPaise(totals.totalPaise)}</p><p style="text-align:center">Thank you!</p></div>`;
    }

    function waiterPage() {
        const tables = data.loadTables();
        const menu = menuItems();
        const ready = allOrders().filter(order => order.stage === 'ready' && order.status !== 'paid');
        return `<section class="dashboard-section" id="tables"><h2>Table status</h2>
            <div class="dashboard-grid">${tables.map(table => `<article class="dashboard-card table-status-card ${esc(table.status)}"><div class="dashboard-row"><h3>Table ${esc(table.number)}</h3><span class="status-pill ${esc(table.status)}">${esc(table.status)}</span></div><button type="button" class="dashboard-action small" data-action="select-table" data-table="${esc(table.number)}">Start order</button></article>`).join('')}</div>
            <article class="dashboard-card" style="margin-top:14px"><h3>Take a new order</h3><form id="waiter-order-form" class="dashboard-form">
                <label>Table<select name="table" required>${tables.map(table => `<option value="${esc(table.number)}">Table ${esc(table.number)} · ${esc(table.status)}</option>`).join('')}</select></label>
                <label>Guest name (optional)<input name="name" autocomplete="off"></label>
                <label>Dish<select name="item" required>${menu.map(item => `<option value="${esc(item.id)}">${esc(item.n)} · ${money(item.p)}</option>`).join('')}</select></label>
                <label>Quantity<input name="quantity" type="number" min="1" max="50" value="1" required></label>
                <button type="button" data-action="add-draft-item">Add dish</button>
                <button type="submit" ${waiterDraft.length ? '' : 'disabled'}>Send order to kitchen</button>
            </form>
            <div class="draft-order-items" aria-live="polite">${waiterDraft.map((item, index) => `<p>${esc(item.q)} × ${esc(item.n)} <button type="button" class="dashboard-action danger small" data-action="remove-draft-item" data-index="${index}" aria-label="Remove ${esc(item.n)} from draft">Remove</button></p>`).join('') || '<p class="dashboard-meta">Add dishes before sending the order.</p>'}</div></article>
            <div class="dashboard-section" id="ready-orders"><h2>Ready to serve</h2>${ready.length ? `<div class="dashboard-grid">${ready.map(order => `<article class="dashboard-card"><div class="dashboard-row"><h3>Order #${esc(order.id)}</h3><span class="status-pill ready">Ready</span></div><p class="dashboard-meta">Table ${esc(order.table)}${order.name ? ` · ${esc(order.name)}` : ''}</p><button class="dashboard-action small" type="button" data-action="mark-served" data-order="${esc(order.id)}">Mark served</button></article>`).join('')}</div>` : '<p class="empty-state">No orders are ready to serve.</p>'}</div>
        </section>`;
    }

    function chefPage() {
        const orders = allOrders().filter(order => order.status === 'new' && ['pending', 'cooking', 'ready'].includes(order.stage || 'pending'));
        return `<section class="dashboard-section" id="kitchen"><h2>Kitchen queue <span class="dashboard-meta">(${orders.length})</span></h2>
            ${orders.length ? `<div class="dashboard-grid">${orders.map(order => {
                const elapsed = Math.max(0, Date.now() - Number(order.time || Date.now()));
                const tooLong = elapsed >= 15 * 60 * 1000;
                const next = order.stage === 'pending' ? 'cooking' : order.stage === 'cooking' ? 'ready' : '';
                const nextLabel = order.stage === 'pending' ? 'Start cooking' : 'Mark ready';
                return `<article class="dashboard-card kitchen-order ${tooLong ? 'waiting-too-long' : ''}" data-order-card="${esc(order.id)}" data-start="${Number(order.time || Date.now())}">
                    <div class="dashboard-row"><h3>Order #${esc(order.id)} · Table ${esc(order.table)}</h3><span class="status-pill ${esc(order.stage || 'pending')}">${esc(stageLabel(order.stage))}</span></div>
                    <p class="dashboard-meta">${order.name ? `${esc(order.name)} · ` : ''}${order.items.map(item => `${esc(item.q)} × ${esc(item.n)}`).join(', ')}</p>
                    <p class="waiting-time" data-timer>Waiting ${formatDuration(elapsed)}</p>
                    ${tooLong ? '<p class="waiting-alert" role="status">Waiting longer than 15 minutes</p>' : ''}
                    ${next ? `<button type="button" class="dashboard-action small" data-action="advance-stage" data-order="${esc(order.id)}" data-stage="${next}">${nextLabel}</button>` : '<p class="dashboard-meta">Ready for the waiter to serve.</p>'}
                </article>`;
            }).join('')}</div>` : '<p class="empty-state">Kitchen queue is clear.</p>'}
        </section>`;
    }

    function readSettings() {
        try {
            return JSON.parse(localStorage.getItem('rb_set') || '{"gst":5,"name":"Neel Tarang"}') || { gst: 5 };
        } catch (error) {
            console.error('Could not read restaurant billing settings.', error);
            return { gst: 5 };
        }
    }

    function validImage(url) {
        if (!url) return '';
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' ? parsed.href : '';
        } catch {
            return '';
        }
    }

    function stageLabel(stage) {
        return ({ pending: 'Received', cooking: 'Cooking', ready: 'Ready', served: 'Served' })[stage] || 'Received';
    }

    function ratingSummary(record) {
        const count = Math.max(0, Number(record?.count) || 0);
        const average = count ? Math.max(0, Number(record.sum) || 0) / count : 0;
        return `<p class="dashboard-rating" aria-label="${count ? `${average.toFixed(1)} out of 5 from ${count} ratings` : 'Not rated yet'}">★ ${count ? `${average.toFixed(1)} · ${count} rating${count === 1 ? '' : 's'}` : 'Not rated yet'}</p>`;
    }

    function formatDuration(milliseconds) {
        const minutes = Math.floor(milliseconds / 60000);
        const seconds = Math.floor(milliseconds / 1000) % 60;
        return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    }

    function bindContent() {
        content.querySelector('#staff-form')?.addEventListener('submit', addStaff);
        content.querySelector('#menu-form')?.addEventListener('submit', saveMenuItem);
        content.querySelector('#menu-cancel')?.addEventListener('click', resetMenuForm);
        content.querySelector('#contact-form')?.addEventListener('submit', saveContact);
        content.querySelector('#waiter-order-form')?.addEventListener('submit', sendWaiterOrder);
        content.addEventListener('change', handleSplitInput);
        content.querySelectorAll('[data-action]').forEach(button => {
            button.addEventListener('click', () => handleAction(button));
        });
        content.querySelectorAll('[data-discount]').forEach(input => {
            input.addEventListener('change', () => updateDiscount(input));
        });
        content.querySelectorAll('[data-service-charge]').forEach(input => {
            input.addEventListener('change', () => updateServiceCharge(input));
        });
    }

    function addStaff(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const username = String(values.get('username')).trim();
        const password = String(values.get('password'));
        const name = String(values.get('name')).trim();
        const selectedRole = String(values.get('role'));
        const staff = data.loadStaff();
        const nameTaken = [...USERS, ...staff].some(account => account.username.toLowerCase() === username.toLowerCase());
        if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username) || nameTaken || password.length < 6 ||
            !['owner', 'cashier', 'waiter', 'chef'].includes(selectedRole)) {
            showToast('Use a unique username (3+ characters) and password (6+ characters).');
            return;
        }
        staff.push({ username, password, role: selectedRole, name });
        if (persist(() => data.saveStaff(staff), 'Staff account added.')) render();
    }

    function saveMenuItem(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const name = String(values.get('name')).trim();
        const category = String(values.get('category')).trim();
        const price = Number(values.get('price'));
        const image = String(values.get('image')).trim();
        const emoji = String(values.get('emoji')).trim() || '🍽️';
        if (!name || !category || !Number.isFinite(price) || price <= 0 ||
            (image && !validImage(image))) {
            showToast('Enter a dish, category, positive price, and HTTPS image URL.');
            return;
        }
        const menu = menuItems();
        const id = String(values.get('id') || '');
        if (id) {
            const item = menu.find(entry => String(entry.id) === id);
            if (item) Object.assign(item, { n: name, c: category, p: price, img: image, e: emoji });
        } else {
            menu.push({ id: Date.now(), n: name, c: category, p: price, img: image, e: emoji });
        }
        if (persist(() => data.saveMenu(menu), id ? 'Menu item updated.' : 'Menu item added.')) render();
    }

    function resetMenuForm() {
        const form = content.querySelector('#menu-form');
        if (!form) return;
        form.reset();
        form.elements.id.value = '';
        form.elements.emoji.value = '🍽️';
        content.querySelector('#menu-submit').textContent = 'Add menu item';
        content.querySelector('#menu-cancel').hidden = true;
    }

    function saveContact(event) {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const current = data.loadContact();
        const next = {
            online: {
                ...current.online, label: 'Online / Delivery',
                phone: String(values.get('onlinePhone')).trim(),
                hours: String(values.get('onlineHours')).trim()
            },
            offline: {
                ...current.offline, label: 'Dine-in',
                phone: String(values.get('offlinePhone')).trim(),
                hours: String(values.get('offlineHours')).trim()
            },
            email: String(values.get('email')).trim(),
            address: String(values.get('address')).trim()
        };
        if (!validHours(next.online.hours) || !validHours(next.offline.hours)) {
            showToast('Use valid opening hours such as 10:00-22:00.');
            return;
        }
        if (persist(() => data.saveContact(next), 'Contact details saved.')) render();
    }

    function validHours(hours) {
        const match = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(hours);
        return Boolean(match && Number(match[1]) < 24 && Number(match[3]) < 24 &&
            Number(match[2]) < 60 && Number(match[4]) < 60);
    }

    function findOrder(id) {
        return allOrders().find(order => String(order.id) === String(id));
    }

    function updateOrders(orders, message) {
        if (persist(() => data.saveOrders(orders), message)) render();
    }

    function handleAction(button) {
        const { action, order: orderId, id, index, username, table, stage } = button.dataset;
        if (action === 'start-split') {
            startSplit(orderId);
        } else if (action === 'cancel-split') {
            splitDraft = null;
            render();
        } else if (action === 'split-method') {
            if (splitDraft && ['equal', 'items', 'custom'].includes(button.dataset.method)) {
                splitDraft.method = button.dataset.method;
                render();
            }
        } else if (action === 'finalize-split') {
            finalizeSplit();
        } else if (action === 'pay-split-invoice') {
            paySplitInvoice(button.dataset.splitId, button.dataset.invoice);
        } else if (action === 'print-split-invoice') {
            printSplitInvoice(button.dataset.splitId, button.dataset.invoice);
        } else if (action === 'review-split') {
            document.querySelector(`#split-${CSS.escape(button.dataset.splitId)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (action === 'remove-staff') {
            const staff = data.loadStaff().filter(member => member.username !== username);
            if (persist(() => data.saveStaff(staff), 'Staff account removed.')) render();
        } else if (action === 'edit-menu') {
            const item = lookupMenu(id);
            const form = content.querySelector('#menu-form');
            if (!item || !form) return;
            form.elements.id.value = item.id;
            form.elements.name.value = item.n;
            form.elements.category.value = item.c;
            form.elements.price.value = item.p;
            form.elements.image.value = item.img || '';
            form.elements.emoji.value = item.e || '🍽️';
            content.querySelector('#menu-submit').textContent = 'Save menu changes';
            content.querySelector('#menu-cancel').hidden = false;
            form.scrollIntoView({ behavior: 'smooth', block: 'center' });
            form.elements.name.focus();
        } else if (action === 'delete-menu') {
            if (!window.confirm('Delete this menu item?')) return;
            const menu = menuItems().filter(item => String(item.id) !== String(id));
            if (persist(() => data.saveMenu(menu), 'Menu item deleted.')) render();
        } else if (action === 'qty-minus' || action === 'qty-plus') {
            changeBillQuantity(orderId, Number(index), action === 'qty-plus' ? 1 : -1);
        } else if (action === 'add-bill-item') {
            const select = content.querySelector(`[data-add-item="${CSS.escape(orderId)}"]`);
            addBillItem(orderId, select?.value);
        } else if (action === 'mark-paid') {
            markOrderPaid(orderId);
        } else if (action === 'print-bill') {
            generateBill(orderId);
        } else if (action === 'select-table') {
            const select = content.querySelector('#waiter-order-form [name="table"]');
            if (select) select.value = table;
            content.querySelector('#waiter-order-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (action === 'add-draft-item') {
            addWaiterDraftItem();
        } else if (action === 'remove-draft-item') {
            rememberWaiterForm();
            waiterDraft.splice(Number(index), 1);
            render();
        } else if (action === 'mark-served') {
            const orders = allOrders();
            const order = orders.find(item => String(item.id) === String(orderId));
            if (!order) return;
            order.stage = 'served';
            updateOrders(orders, 'Order marked as served.');
        } else if (action === 'advance-stage') {
            const orders = allOrders();
            const order = orders.find(item => String(item.id) === String(orderId));
            if (!order || !['cooking', 'ready'].includes(stage)) return;
            order.stage = stage;
            updateOrders(orders, `Order #${orderId} is ${stage}.`);
        }
    }

    function changeBillQuantity(orderId, itemIndex, change) {
        if (data.loadSplitBills().some(record => String(record.orderId) === String(orderId))) {
            showToast('This order is locked because split invoices have been created.');
            return;
        }
        const orders = allOrders();
        const order = orders.find(item => String(item.id) === String(orderId));
        if (!order || !order.items[itemIndex]) return;
        order.items[itemIndex].q = Math.max(0, Number(order.items[itemIndex].q || 0) + change);
        order.items = order.items.filter(item => item.q > 0);
        updateOrders(orders);
    }

    function addBillItem(orderId, menuId) {
        if (data.loadSplitBills().some(record => String(record.orderId) === String(orderId))) {
            showToast('This order is locked because split invoices have been created.');
            return;
        }
        const item = lookupMenu(menuId);
        const orders = allOrders();
        const order = orders.find(entry => String(entry.id) === String(orderId));
        if (!item || !order) return;
        const existing = order.items.find(entry => String(entry.id) === String(item.id));
        if (existing) existing.q = Number(existing.q || 0) + 1;
        else order.items.push({ id: item.id, n: item.n, p: Number(item.p), q: 1 });
        updateOrders(orders);
    }

    function updateDiscount(input) {
        const orders = allOrders();
        const order = orders.find(item => String(item.id) === String(input.dataset.discount));
        if (!order) return;
        if (data.loadSplitBills().some(record => String(record.orderId) === String(order.id))) {
            showToast('This order is locked because split invoices have been created.');
            render();
            return;
        }
        order.discountPercent = Math.max(0, Math.min(100, Number(input.value || 0)));
        updateOrders(orders);
    }

    function updateServiceCharge(input) {
        const amount = Number(input.value);
        const orders = allOrders();
        const order = orders.find(item => String(item.id) === String(input.dataset.serviceCharge));
        if (!order) return;
        if (data.loadSplitBills().some(record => String(record.orderId) === String(order.id))) {
            showToast('This order is locked because split invoices have been created.');
            render();
            return;
        }
        if (!Number.isFinite(amount) || amount < 0) {
            showToast('Enter a non-negative service charge.');
            render();
            return;
        }
        order.serviceCharge = amount;
        updateOrders(orders);
    }

    function totalsFor(order) {
        const bill = window.RestaurantSplitBill.calculateTotals(
            order,
            order.discountPercent || 0,
            readSettings().gst || 0
        );
        return {
            sub: window.RestaurantSplitBill.fromPaise(bill.subtotalPaise),
            discount: window.RestaurantSplitBill.fromPaise(bill.discountPaise),
            gst: window.RestaurantSplitBill.fromPaise(bill.taxPaise),
            serviceCharge: window.RestaurantSplitBill.fromPaise(bill.serviceChargePaise),
            rate: bill.gstPercent,
            total: window.RestaurantSplitBill.fromPaise(bill.totalPaise)
        };
    }

    function markOrderPaid(orderId) {
        const orders = allOrders();
        const order = orders.find(item => String(item.id) === String(orderId));
        if (!order) return;
        if (data.loadSplitBills().some(record => String(record.orderId) === String(orderId))) {
            showToast('This order has split invoices. Record payment on an individual invoice.');
            return;
        }
        const totals = totalsFor(order);
        const payment = content.querySelector(`[data-payment="${CSS.escape(String(orderId))}"]`);
        order.status = 'paid';
        order.bill = {
            sub: totals.sub - totals.discount,
            discount: totals.discount,
            g: totals.gst,
            tot: totals.total,
            rate: totals.rate,
            mode: payment?.value || order.paymentMethod || 'Cash',
            paidAt: Date.now()
        };
        order.bill.serviceCharge = totals.serviceCharge;
        updateOrders(orders, `Payment recorded for order #${orderId}.`);
    }

    function startSplit(orderId) {
        const order = findOrder(orderId);
        if (!order || order.status !== 'new') {
            showToast('Only an open order can be split.');
            return;
        }
        if (data.loadSplitBills().some(record => String(record.orderId) === String(orderId))) {
            showToast('A split bill already exists for this order.');
            return;
        }
        try {
            splitDraft = createSplitDraft(order);
        } catch (error) {
            showToast(error.message);
            return;
        }
        render();
        content.querySelector('#split-editor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function handleSplitInput(event) {
        if (!splitDraft) return;
        const input = event.target;
        if (input.matches('[data-split-count]')) {
            const count = Number(input.value);
            if (!Number.isInteger(count) || count < 2 || count > 12) {
                showToast('Choose between 2 and 12 customers.');
                render();
                return;
            }
            const order = findOrder(splitDraft.orderId);
            const bill = window.RestaurantSplitBill.calculateTotals(order, order.discountPercent || 0, readSettings().gst || 0);
            splitDraft.count = count;
            splitDraft.labels = Array.from({ length: count }, (_, index) => `Customer ${index + 1}`);
            splitDraft.itemAllocations = bill.itemLines.map((item, lineIndex) => {
                const previous = splitDraft.itemAllocations[lineIndex] || [];
                const next = Array(count).fill(0);
                let unassigned = item.quantity;
                for (let customerIndex = 0; customerIndex < count; customerIndex += 1) {
                    next[customerIndex] = Math.min(unassigned, Math.max(0, Number(previous[customerIndex] || 0)));
                    unassigned -= next[customerIndex];
                }
                if (unassigned > 0) next[0] += unassigned;
                return next;
            });
            const share = Math.floor(bill.totalPaise / count);
            splitDraft.customAmounts = Array.from({ length: count }, (_, index) =>
                window.RestaurantSplitBill.fromPaise(share + (index < bill.totalPaise % count ? 1 : 0)).toFixed(2));
            render();
        } else if (input.matches('[data-split-item]')) {
            const lineIndex = Number(input.dataset.splitItem);
            const customerIndex = Number(input.dataset.customer);
            splitDraft.itemAllocations[lineIndex][customerIndex] = input.value === '' ? 0 : Number(input.value);
            render();
        } else if (input.matches('[data-split-amount]')) {
            splitDraft.customAmounts[Number(input.dataset.splitAmount)] = input.value;
            render();
        } else if (input.matches('[data-record-balance]')) {
            splitDraft.recordRemainder = input.checked;
            render();
        }
    }

    function finalizeSplit() {
        if (!splitDraft) return;
        const order = findOrder(splitDraft.orderId);
        if (!order || order.status !== 'new') {
            showToast('This order is no longer open.');
            return;
        }
        if (data.loadSplitBills().some(record => String(record.orderId) === String(order.id))) {
            showToast('A split bill already exists for this order.');
            splitDraft = null;
            render();
            return;
        }
        let bill;
        try {
            bill = window.RestaurantSplitBill.calculateTotals(order, order.discountPercent || 0, readSettings().gst || 0);
        } catch (error) {
            showToast(error.message);
            return;
        }
        const result = window.RestaurantSplitBill.buildSplit(order, splitDraft, bill);
        if (!result.ok) {
            showToast(result.error || 'Check the split allocations.');
            return;
        }
        const savedRecords = data.loadSplitBills();
        let splitId = `SPL-${Date.now().toString(36).toUpperCase()}`;
        while (savedRecords.some(record => record.id === splitId)) splitId += 'X';
        const createdAt = Date.now();
        const record = {
            version: 1,
            id: splitId,
            orderId: String(order.id),
            method: splitDraft.method,
            status: 'unpaid',
            createdAt,
            createdBy: user.name,
            totals: {
                subtotalPaise: bill.subtotalPaise,
                discountPaise: bill.discountPaise,
                serviceChargePaise: bill.serviceChargePaise,
                taxPaise: bill.taxPaise,
                totalPaise: bill.totalPaise,
                discountPercent: Number(order.discountPercent || 0),
                gstPercent: bill.gstPercent
            },
            originalOrder: JSON.parse(JSON.stringify(order)),
            invoices: result.invoices.map((invoice, index) => ({
                ...invoice,
                invoiceNo: `${splitId}-${String(index + 1).padStart(2, '0')}`,
                paidAmountPaise: 0
            }))
        };
        if (!persist(() => data.saveSplitBill(record))) return;
        splitDraft = null;
        const orders = allOrders();
        const original = orders.find(item => String(item.id) === String(order.id));
        if (original) {
            original.splitBillId = splitId;
            if (!persist(() => data.saveOrders(orders), 'Split invoices created.')) render();
        } else {
            showToast('Split invoices saved, but the original order link could not be updated.');
            render();
        }
    }

    function paySplitInvoice(splitId, invoiceNo) {
        const selector = Array.from(content.querySelectorAll('[data-split-payment]'))
            .find(input => input.dataset.splitPayment === splitId && input.dataset.invoice === invoiceNo);
        const method = selector?.value || '';
        let record;
        if (!persist(() => {
            record = data.recordSplitPayment(splitId, invoiceNo, method);
        }, 'Invoice payment recorded.')) return;
        if (record.status === 'paid') {
            const orders = allOrders();
            const order = orders.find(item => String(item.id) === String(record.orderId));
            if (order) {
                order.status = 'paid';
                order.splitBillId = record.id;
                order.bill = {
                    sub: window.RestaurantSplitBill.fromPaise(record.totals.subtotalPaise - record.totals.discountPaise),
                    discount: window.RestaurantSplitBill.fromPaise(record.totals.discountPaise),
                    g: window.RestaurantSplitBill.fromPaise(record.totals.taxPaise),
                    serviceCharge: window.RestaurantSplitBill.fromPaise(record.totals.serviceChargePaise || 0),
                    tot: window.RestaurantSplitBill.fromPaise(record.totals.totalPaise),
                    rate: record.totals.gstPercent,
                    mode: 'Split payments',
                    paidAt: Date.now()
                };
                persist(() => data.saveOrders(orders));
            }
        }
        render();
    }

    function printSplitInvoice(splitId, invoiceNo) {
        const record = data.loadSplitBills().find(saved => saved.id === splitId);
        const invoice = record?.invoices.find(saved => saved.invoiceNo === invoiceNo);
        if (!record || !invoice) {
            showToast('Split invoice not found.');
            return;
        }
        splitPrintHTML = printInvoiceHTML(record, invoice);
        render();
        window.setTimeout(() => {
            document.body.classList.add('printing-split');
            window.print();
            document.body.classList.remove('printing-split');
        }, 50);
    }

    function generateBill(orderId) {
        const order = findOrder(orderId);
        if (!order) return;
        const totals = order.status === 'paid' && order.bill
            ? { sub: order.bill.sub, discount: order.bill.discount || 0, serviceCharge: order.bill.serviceCharge || 0, gst: order.bill.g, rate: order.bill.rate, total: order.bill.tot }
            : totalsFor(order);
        const restaurant = readSettings().name || 'Neel Tarang';
        printBillHTML = `<div class="print-bill-content"><h2>${esc(restaurant)}</h2><p>Bill #${esc(order.id)} · Table ${esc(order.table)}</p><p>${new Date(order.time || Date.now()).toLocaleString('en-IN')}</p><hr>${(order.items || []).map(item => `<p>${esc(item.q)} × ${esc(item.n)} = ${money(Number(item.q) * Number(item.p))}</p>`).join('')}<hr><p>Subtotal: ${money(totals.sub + totals.discount)}</p>${totals.discount ? `<p>Discount: -${money(totals.discount)}</p>` : ''}${totals.serviceCharge ? `<p>Service charge: ${money(totals.serviceCharge)}</p>` : ''}<p>GST ${esc(totals.rate)}%: ${money(totals.gst)}</p><strong>Total: ${money(totals.total)}</strong>${order.status === 'paid' ? `<p>Paid via ${esc(order.bill.mode)}</p>` : ''}<p>Thank you for dining with us!</p></div>`;
        render();
        window.setTimeout(() => {
            document.body.classList.add('printing-bill');
            window.print();
            document.body.classList.remove('printing-bill');
        }, 50);
    }

    function addWaiterDraftItem() {
        const form = content.querySelector('#waiter-order-form');
        if (!form) return;
        rememberWaiterForm();
        const item = lookupMenu(form.elements.namedItem('item').value);
        const quantity = Math.min(50, Math.max(1, Number(form.elements.quantity.value || 1)));
        if (!item) return;
        const existing = waiterDraft.find(entry => String(entry.id) === String(item.id));
        if (existing) existing.q += quantity;
        else waiterDraft.push({ id: item.id, n: item.n, p: Number(item.p), q: quantity });
        render();
    }

    function rememberWaiterForm() {
        const form = content.querySelector('#waiter-order-form');
        if (!form) return;
        waiterFormState = {
            table: form.elements.table.value,
            name: form.elements.name.value,
            item: form.elements.namedItem('item').value,
            quantity: form.elements.quantity.value
        };
    }

    function sendWaiterOrder(event) {
        event.preventDefault();
        if (!waiterDraft.length) {
            showToast('Add at least one dish first.');
            return;
        }
        const form = event.currentTarget;
        const orders = allOrders();
        const id = Math.max(1000, ...orders.map(order => Number(order.id) || 0)) + 1;
        const values = new FormData(form);
        orders.push({
            id,
            table: String(values.get('table')),
            name: String(values.get('name') || '').trim(),
            phone: '',
            items: waiterDraft.map(item => ({ ...item })),
            status: 'new',
            stage: 'pending',
            time: Date.now()
        });
        waiterDraft = [];
        waiterFormState = {};
        updateOrders(orders, `Order #${id} sent to the kitchen.`);
    }

    function updateTimers() {
        content.querySelectorAll('[data-timer]').forEach(timer => {
            const card = timer.closest('[data-start]');
            if (!card) return;
            const elapsed = Math.max(0, Date.now() - Number(card.dataset.start));
            timer.textContent = `Waiting ${formatDuration(elapsed)}`;
            if (elapsed >= 15 * 60 * 1000) card.classList.add('waiting-too-long');
        });
    }

    function render() {
        if (role === 'owner') {
            content.innerHTML = pageHeader() + ownerOverview() + ownerStaff() + ownerMenu() + ownerContact();
        } else if (role === 'cashier') {
            content.innerHTML = pageHeader() + cashierBilling();
        } else if (role === 'waiter') {
            content.innerHTML = pageHeader() + waiterPage();
        } else {
            content.innerHTML = pageHeader() + chefPage();
        }
        bindContent();
        if (role === 'waiter' && Object.keys(waiterFormState).length) {
            const form = content.querySelector('#waiter-order-form');
            if (form) {
                form.elements.table.value = waiterFormState.table;
                form.elements.name.value = waiterFormState.name;
                form.elements.namedItem('item').value = waiterFormState.item;
                form.elements.quantity.value = waiterFormState.quantity;
            }
        }
        if (role === 'chef') updateTimers();
    }

    function renderAndRebind() {
        render();
        setActiveAnchor(activeAnchor);
    }

    function refreshLiveData(event) {
        const key = event?.key || event?.detail?.key;
        if (!key || ['rb_orders', 'rb_menu', 'rb_tables', 'rb_staff_users', 'rb_contact_details', 'rb_set', 'rb_food_ratings', 'rb_split_bills_v1'].includes(key)) {
            renderAndRebind();
        }
    }

    setupNavigation();
    render();
    window.addEventListener('storage', refreshLiveData);
    window.addEventListener('restaurant:datachange', refreshLiveData);
    if (role === 'chef') window.setInterval(updateTimers, 1000);
})();
