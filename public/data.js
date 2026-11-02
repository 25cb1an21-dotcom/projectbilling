// Keep these menu defaults aligned with the customer ordering page.
(() => {
    const MENU_KEY = 'rb_menu';
    const ORDERS_KEY = 'rb_orders';
    const TABLES_KEY = 'rb_tables';
    const SPLIT_BILLS_KEY = 'rb_split_bills_v1';
    const defaultMenu = [
        { id: 1, n: 'Paneer Butter Masala', c: 'Main Course', p: 220, e: '🍛', img: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=800&q=85' },
        { id: 2, n: 'Dal Makhani', c: 'Main Course', p: 180, e: '🥘', img: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=800&q=85' },
        { id: 3, n: 'Veg Biryani', c: 'Main Course', p: 200, e: '🍚', img: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=800&q=85' },
        { id: 4, n: 'Butter Naan', c: 'Breads', p: 45, e: '🫓', img: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=800&q=85' },
        { id: 5, n: 'Tandoori Roti', c: 'Breads', p: 25, e: '🫓', img: 'https://images.unsplash.com/photo-1628294895950-9805252327bc?auto=format&fit=crop&w=800&q=85' },
        { id: 6, n: 'Veg Manchurian', c: 'Starters', p: 150, e: '🥟', img: 'https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=800&q=85' },
        { id: 7, n: 'Paneer Tikka', c: 'Starters', p: 210, e: '🍢', img: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=800&q=85' },
        { id: 8, n: 'Masala Dosa', c: 'South Indian', p: 110, e: '🌯', img: 'https://images.unsplash.com/photo-1668236543090-82eba5ee5976?auto=format&fit=crop&w=800&q=85' },
        { id: 9, n: 'Gulab Jamun (2 pc)', c: 'Desserts', p: 70, e: '🍮', img: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=800&q=85' },
        { id: 10, n: 'Sweet Lassi', c: 'Drinks', p: 60, e: '🥛', img: 'https://images.unsplash.com/photo-1570197788417-0e82375c9371?auto=format&fit=crop&w=800&q=85' },
        { id: 11, n: 'Masala Chai', c: 'Drinks', p: 25, e: '☕', img: 'https://images.unsplash.com/photo-1571934811356-5cc061b6821f?auto=format&fit=crop&w=800&q=85' },
        { id: 12, n: 'Fresh Lime Soda', c: 'Drinks', p: 50, e: '🍋', img: 'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=800&q=85' }
    ];

    function read(key, fallback) {
        try {
            const value = JSON.parse(localStorage.getItem(key));
            return value === null ? fallback : value;
        } catch (error) {
            console.error(`Could not read ${key} from local storage.`, error);
            return fallback;
        }
    }

    function write(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.error(`Could not save ${key} to local storage.`, error);
            throw error;
        }
        window.dispatchEvent(new CustomEvent('restaurant:datachange', { detail: { key } }));
    }

    function initialOrders() {
        const now = Date.now();
        return [
            {
                id: 9901, table: '1', name: 'Walk-in', phone: '', paymentMethod: 'UPI',
                items: [{ id: 1, n: 'Paneer Butter Masala', p: 220, q: 1 }, { id: 4, n: 'Butter Naan', p: 45, q: 2 }],
                status: 'paid', stage: 'served', time: now - 60 * 60 * 1000,
                bill: { sub: 310, g: 15.5, tot: 326, rate: 5, mode: 'UPI', paidAt: now - 45 * 60 * 1000 }
            },
            {
                id: 9902, table: '2', name: 'Demo Guest', phone: '', paymentMethod: 'after-delivery',
                items: [{ id: 3, n: 'Veg Biryani', p: 200, q: 1 }, { id: 10, n: 'Sweet Lassi', p: 60, q: 1 }],
                status: 'new', stage: 'pending', time: now - 8 * 60 * 1000
            },
            {
                id: 9903, table: '3', name: 'Demo Guest', phone: '', paymentMethod: 'after-delivery',
                items: [{ id: 6, n: 'Veg Manchurian', p: 150, q: 1 }],
                status: 'new', stage: 'cooking', time: now - 17 * 60 * 1000
            }
        ];
    }

    function seed() {
        if (localStorage.getItem(MENU_KEY) === null) write(MENU_KEY, defaultMenu);
        if (localStorage.getItem(ORDERS_KEY) === null) write(ORDERS_KEY, initialOrders());
        if (localStorage.getItem(TABLES_KEY) === null) {
            write(TABLES_KEY, Array.from({ length: 12 }, (_, index) => ({
                number: String(index + 1),
                status: index === 0 || index === 1 || index === 2 ? 'occupied' : 'free'
            })));
        }
    }

    function updateTables(orders) {
        const currentTables = read(TABLES_KEY, []);
        const numbers = new Set([
            ...currentTables.map(table => String(table.number)),
            ...orders.map(order => String(order.table))
        ]);
        const occupied = new Set(orders
            .filter(order => order.stage !== 'served')
            .map(order => String(order.table)));
        write(TABLES_KEY, [...numbers].filter(Boolean).map(number => ({
            number,
            status: occupied.has(number) ? 'occupied' : 'free'
        })));
    }

    function loadSplitBills() {
        const records = read(SPLIT_BILLS_KEY, []);
        if (!Array.isArray(records)) {
            console.error('Split-bill storage must contain a list of records.');
            return [];
        }
        return records;
    }

    function saveSplitBill(record) {
        const records = loadSplitBills();
        if (!record || !record.id || !record.orderId || !Array.isArray(record.invoices) || !record.invoices.length) {
            throw new Error('The split bill is missing its order or invoice details.');
        }
        if (records.some(saved => saved.id === record.id || String(saved.orderId) === String(record.orderId))) {
            throw new Error('A split bill already exists for this order.');
        }
        const total = Number(record.totals?.totalPaise);
        const invoiceTotal = record.invoices.reduce((sum, invoice) => {
            const amount = Number(invoice.totalPaise);
            if (!invoice.invoiceNo || !Number.isInteger(amount) || amount <= 0) {
                throw new Error('Every split invoice must have a unique number and positive amount.');
            }
            return sum + amount;
        }, 0);
        const invoiceNumbers = new Set(record.invoices.map(invoice => invoice.invoiceNo));
        if (!Number.isInteger(total) || total <= 0 || invoiceTotal !== total ||
            invoiceNumbers.size !== record.invoices.length) {
            throw new Error('Split invoice totals must exactly match the original bill.');
        }
        return write(SPLIT_BILLS_KEY, [...records, record]);
    }

    function recordSplitPayment(splitId, invoiceNo, method) {
        const records = loadSplitBills();
        const record = records.find(saved => saved.id === splitId);
        if (!record) throw new Error('Split-bill record not found.');
        const invoice = record.invoices.find(saved => saved.invoiceNo === invoiceNo);
        if (!invoice) throw new Error('Split invoice not found.');
        if (invoice.status === 'paid' || invoice.payments?.length) {
            throw new Error('Payment has already been recorded for this invoice.');
        }
        if (!['Cash', 'UPI', 'Card'].includes(method)) throw new Error('Choose Cash, UPI, or Card.');
        const amountPaise = Number(invoice.totalPaise);
        if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new Error('Invoice amount is invalid.');
        invoice.status = 'paid';
        invoice.paidAmountPaise = amountPaise;
        invoice.payments = [{
            id: `PAY-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            amountPaise,
            method,
            paidAt: Date.now()
        }];
        const paidCount = record.invoices.filter(saved => saved.status === 'paid').length;
        record.status = paidCount === record.invoices.length
            ? 'paid'
            : paidCount ? 'partially_paid' : 'unpaid';
        write(SPLIT_BILLS_KEY, records);
        return record;
    }

    const api = {
        loadMenu: () => read(MENU_KEY, defaultMenu),
        saveMenu: menu => write(MENU_KEY, menu),
        loadOrders: () => read(ORDERS_KEY, []),
        saveOrders: orders => {
            write(ORDERS_KEY, orders);
            updateTables(orders);
        },
        loadSplitBills,
        saveSplitBill,
        recordSplitPayment,
        loadRatings: () => {
            const ratings = read('rb_food_ratings', {});
            return ratings && typeof ratings === 'object' && !Array.isArray(ratings) ? ratings : {};
        },
        loadTables: () => read(TABLES_KEY, []),
        saveTables: tables => write(TABLES_KEY, tables),
        loadContact: () => read('rb_contact_details', {
            online: { label: 'Online / Delivery', hours: '10:00-22:00', phone: '+91 8349539933' },
            offline: { label: 'Dine-in', hours: '11:00-20:00', phone: '+91 6264290195' },
            email: 'hello@yourrestaurant.com',
            address: 'Your full address here'
        }),
        saveContact: contact => write('rb_contact_details', contact),
        loadStaff: () => read('rb_staff_users', []),
        saveStaff: staff => write('rb_staff_users', staff)
    };

    try {
        seed();
    } catch (error) {
        console.error('Could not initialize restaurant demo data.', error);
    }
    window.RestaurantData = api;
})();
