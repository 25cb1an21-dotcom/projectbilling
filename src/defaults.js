// Default menu and tables used the first time the server starts.
// Keep in sync with the defaults in public/data.js and public/order.html.

const DEFAULT_MENU = [
  {
    "id": 1,
    "n": "Paneer Butter Masala",
    "c": "Main Course",
    "p": 220,
    "e": "🍛",
    "img": "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=800&q=85"
  },
  {
    "id": 2,
    "n": "Dal Makhani",
    "c": "Main Course",
    "p": 180,
    "e": "🥘",
    "img": "https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=800&q=85"
  },
  {
    "id": 3,
    "n": "Veg Biryani",
    "c": "Main Course",
    "p": 200,
    "e": "🍚",
    "img": "https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=800&q=85"
  },
  {
    "id": 4,
    "n": "Butter Naan",
    "c": "Breads",
    "p": 45,
    "e": "🫓",
    "img": "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=800&q=85"
  },
  {
    "id": 5,
    "n": "Tandoori Roti",
    "c": "Breads",
    "p": 25,
    "e": "🫓",
    "img": "https://images.unsplash.com/photo-1628294895950-9805252327bc?auto=format&fit=crop&w=800&q=85"
  },
  {
    "id": 6,
    "n": "Veg Manchurian",
    "c": "Starters",
    "p": 150,
    "e": "🥟",
    "img": "https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=800&q=85"
  },
  {
    "id": 7,
    "n": "Paneer Tikka",
    "c": "Starters",
    "p": 210,
    "e": "🍢",
    "img": "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=800&q=85"
  },
  {
    "id": 8,
    "n": "Masala Dosa",
    "c": "South Indian",
    "p": 110,
    "e": "🌯",
    "img": "https://images.unsplash.com/photo-1668236543090-82eba5ee5976?auto=format&fit=crop&w=800&q=85"
  },
  {
    "id": 9,
    "n": "Gulab Jamun (2 pc)",
    "c": "Desserts",
    "p": 70,
    "e": "🍮",
    "img": "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=800&q=85"
  },
  {
    "id": 10,
    "n": "Sweet Lassi",
    "c": "Drinks",
    "p": 60,
    "e": "🥛",
    "img": "https://images.unsplash.com/photo-1570197788417-0e82375c9371?auto=format&fit=crop&w=800&q=85"
  },
  {
    "id": 11,
    "n": "Masala Chai",
    "c": "Drinks",
    "p": 25,
    "e": "☕",
    "img": "https://images.unsplash.com/photo-1571934811356-5cc061b6821f?auto=format&fit=crop&w=800&q=85"
  },
  {
    "id": 12,
    "n": "Fresh Lime Soda",
    "c": "Drinks",
    "p": 50,
    "e": "🍋",
    "img": "https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=800&q=85"
  }
];

const DEFAULT_TABLES = Array.from({ length: 12 }, (_, index) => ({ number: String(index + 1), status: 'free' }));

const DEFAULT_CONTACT = {
  online: { label: 'Online / Delivery', hours: '10:00-22:00', phone: '+91 8349539933' },
  offline: { label: 'Dine-in', hours: '11:00-20:00', phone: '+91 6264290195' },
  email: 'hello@yourrestaurant.com',
  address: 'Your full address here'
};

const DEFAULT_SETTINGS = { name: 'Neel Tarang', gst: 5, gstin: '' };

const PRIZES = ['5% off', '10% off', 'Free Gulab Jamun', 'Better luck next time'];

module.exports = { DEFAULT_MENU, DEFAULT_TABLES, DEFAULT_CONTACT, DEFAULT_SETTINGS, PRIZES };
