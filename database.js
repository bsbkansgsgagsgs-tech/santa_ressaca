const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
require('dotenv').config({ override: true });

const Database = {
    // Pegar URL limpa
    getSql: () => {
        const url = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
        if (!url) return null;
        return neon(url);
    },

    init: async () => {
        const sql = Database.getSql();
        if (!sql) return;
        try {
            // Migrações para garantir que a tabela users tenha is_admin e phone
            await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE`.catch(() => { });
            await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT`.catch(() => { });

            // Lidar com colunas legadas da tabela orders que podem causar erros de constraint
            await sql`ALTER TABLE orders ALTER COLUMN product_name DROP NOT NULL`.catch(() => { });
            await sql`ALTER TABLE orders ALTER COLUMN price DROP NOT NULL`.catch(() => { });
            await sql`ALTER TABLE orders ALTER COLUMN quantity DROP NOT NULL`.catch(() => { });
            await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT`.catch(() => { });

            // SINCRO DA TABELA ORDERS (MUITO IMPORTANTE)
            await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id INTEGER`.catch(() => { });
            await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT`.catch(() => { });
            await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT`.catch(() => { });
            await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS items TEXT`.catch(() => { });
            await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS total NUMERIC DEFAULT 0`.catch(() => { });
            await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendente'`.catch(() => { });
            await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pendente'`.catch(() => { });
            await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT`.catch(() => { });
            await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS mp_payment_id TEXT`.catch(() => { });
            await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'online'`.catch(() => { });
            await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS change_amount NUMERIC`.catch(() => { });
            await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email TEXT`.catch(() => { });
            await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS closure_id INTEGER`.catch(() => { });

            // SINCRO DA TABELA USERS

            // Tabelas principais
            await sql`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    phone TEXT,
                    is_admin BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `;

            await sql`
                CREATE TABLE IF NOT EXISTS cash_closures (
                    id SERIAL PRIMARY KEY,
                    opening_value NUMERIC NOT NULL,
                    closing_value NUMERIC,
                    expected_value NUMERIC,
                    status TEXT DEFAULT 'open',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    closed_at TIMESTAMP
                )
            `;

            await sql`
                CREATE TABLE IF NOT EXISTS orders (
                    id SERIAL PRIMARY KEY,
                    customer_id INTEGER REFERENCES users(id),
                    customer_name TEXT NOT NULL,
                    customer_phone TEXT,
                    items TEXT,
                    total NUMERIC NOT NULL,
                    status TEXT DEFAULT 'pendente',
                    payment_status TEXT DEFAULT 'pendente',
                    delivery_address TEXT,
                    closure_id INTEGER REFERENCES cash_closures(id),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `;

            // Novas tabelas para gestão
            await sql`
                CREATE TABLE IF NOT EXISTS products (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    price NUMERIC NOT NULL,
                    category TEXT,
                    image_url TEXT,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `;
            await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`.catch(() => { });

            await sql`
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            `;

            await sql`
                CREATE TABLE IF NOT EXISTS messages (
                    id SERIAL PRIMARY KEY,
                    order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
                    sender_role TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `;
            console.log('✅ Banco conectado: Tabelas sincronizadas.');
        } catch (e) {
            console.error('❌ Erro Crítico no Banco:', e.message);
        }
    },

    createUser: async (name, email, password, phone) => {
        const sql = Database.getSql();
        if (!sql) throw new Error('Sem banco.');

        try {
            const hash = bcrypt.hashSync(password, 10);
            const res = await sql`
                INSERT INTO users (name, email, password, phone) 
                VALUES (${name}, ${email}, ${hash}, ${phone}) 
                RETURNING id, name, email, phone, is_admin
            `;
            return res[0];
        } catch (e) {
            console.error('❌ Erro Cadastro:', e.message);
            // Mensagem amigável para email duplicado
            if (e.message.includes('unique constraint') || e.code === '23505') {
                throw new Error('Este e-mail já está cadastrado. Que tal fazer login? 🛑');
            }
            throw new Error('Ops! Tivemos um problema técnico. Tente novamente mais tarde.');
        }
    },

    createOrder: async (data) => {
        const sql = Database.getSql();
        if (!sql) throw new Error('Sem banco.');
        try {
            // const openClosure = await Database.getOpenClosure(); // REMOVED
            // const closureId = openClosure ? openClosure.id : null; // REMOVED

            const { customer_id, customer_name, customer_phone, items, total, delivery_address } = data;
            const res = await sql`
                INSERT INTO orders (customer_id, customer_name, customer_phone, items, total, delivery_address)
                VALUES (${customer_id || null}, ${customer_name}, ${customer_phone}, ${items}, ${total}, ${delivery_address || null})
                RETURNING *
            `;
            return res[0];
        } catch (e) {
            console.error('❌ Erro ao criar pedido:', e.message);
            throw e;
        }
    },

    getOrders: async (status = null) => {
        const sql = Database.getSql();
        if (!sql) return [];
        try {
            if (status) {
                return await sql`SELECT * FROM orders WHERE status = ${status} ORDER BY created_at DESC`;
            }
            return await sql`SELECT * FROM orders ORDER BY created_at DESC`;
        } catch (e) {
            console.error('❌ Erro ao buscar pedidos:', e.message);
            return [];
        }
    },

    getOrderById: async (id) => {
        const sql = Database.getSql();
        if (!sql) return null;
        try {
            const res = await sql`SELECT * FROM orders WHERE id = ${id}`;
            return res[0];
        } catch (e) {
            console.error('❌ Erro ao buscar pedido por ID:', e.message);
            return null;
        }
    },

    updateOrderStatus: async (id, status) => {
        const sql = Database.getSql();
        if (!sql) throw new Error('Sem banco.');
        try {
            const res = await sql`
                UPDATE orders SET status = ${status} WHERE id = ${id} RETURNING *
            `;
            return res[0];
        } catch (e) {
            console.error('❌ Erro ao atualizar status:', e.message);
            throw e;
        }
    },

    getUserOrders: async (userId) => {
        const sql = Database.getSql();
        if (!sql) return [];
        try {
            return await sql`SELECT * FROM orders WHERE customer_id = ${userId} ORDER BY created_at DESC`;
        } catch (e) {
            console.error('❌ Erro ao buscar pedidos do usuário:', e.message);
            return [];
        }
    },

    findUserByEmail: async (email) => {
        const sql = Database.getSql();
        if (!sql) return null;
        const res = await sql`SELECT * FROM users WHERE email = ${email}`;
        return res[0];
    },

    // Métodos de entrega removidos

    // PRODUTOS
    getProducts: async () => {
        const sql = Database.getSql();
        if (!sql) return [];
        return await sql`SELECT * FROM products ORDER BY category, name`;
    },

    createProduct: async (p) => {
        const sql = Database.getSql();
        return await sql`
            INSERT INTO products (name, description, price, category, image_url, is_active)
            VALUES (${p.name}, ${p.description}, ${p.price}, ${p.category}, ${p.image_url}, ${p.is_active !== undefined ? p.is_active : true})
            RETURNING *
        `;
    },

    updateProduct: async (id, p) => {
        const sql = Database.getSql();
        return await sql`
            UPDATE products 
            SET name=${p.name}, description=${p.description}, price=${p.price}, category=${p.category}, image_url=${p.image_url}, is_active=${p.is_active}
            WHERE id=${id} RETURNING *
        `;
    },

    deleteProduct: async (id) => {
        const sql = Database.getSql();
        return await sql`DELETE FROM products WHERE id = ${id}`;
    },

    // CONFIGURAÇÕES
    getSettings: async () => {
        const sql = Database.getSql();
        const res = await sql`SELECT * FROM settings`;
        const settings = {};
        res.forEach(row => settings[row.key] = row.value);
        return settings;
    },

    updateSetting: async (key, value) => {
        const sql = Database.getSql();
        return await sql`
            INSERT INTO settings (key, value) VALUES (${key}, ${value})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            RETURNING *
        `;
    },

    // RELATÓRIOS
    getStats: async () => {
        const sql = Database.getSql();
        try {
            // Filtra por pedidos de hoje (data atual)
            const revenueRes = await sql`SELECT SUM(total) as total FROM orders WHERE status = 'entregue' AND created_at >= CURRENT_DATE`;
            const countRes = await sql`SELECT COUNT(*) as count FROM orders WHERE created_at >= CURRENT_DATE`;
            const topProducts = await sql`SELECT items, COUNT(*) as qty FROM orders WHERE created_at >= CURRENT_DATE GROUP BY items ORDER BY qty DESC LIMIT 3`;

            return {
                todayRevenue: revenueRes[0].total || 0,
                todayCount: parseInt(countRes[0].count) || 0,
                topProducts: topProducts
            };
        } catch (e) {
            console.error('❌ Erro ao buscar stats:', e.message);
            return { todayRevenue: 0, todayCount: 0, topProducts: [] };
        }
    },

    // CHAT
    getMessages: async (orderId) => {
        const sql = Database.getSql();
        if (!sql) return [];
        return await sql`SELECT * FROM messages WHERE order_id = ${orderId} ORDER BY created_at ASC`;
    },

    createMessage: async (orderId, senderRole, message) => {
        const sql = Database.getSql();
        if (!sql) return null;
        const res = await sql`
            INSERT INTO messages (order_id, sender_role, message)
            VALUES (${orderId}, ${senderRole}, ${message})
            RETURNING *
        `;
        return res[0];
    },

    findOrderIdByPhone: async (phone) => {
        const sql = Database.getSql();
        if (!sql) return null;
        // Pega os últimos 8 dígitos para ser robusto (ignora 55, DDD, ou nono dígito em alguns casos)
        const cleanPhone = phone.replace(/\D/g, '');
        const lastDigits = cleanPhone.slice(-8);

        if (!lastDigits) return null;

        const res = await sql`
            SELECT id FROM orders 
            WHERE (customer_phone LIKE ${'%' + lastDigits})
            ORDER BY created_at DESC LIMIT 1
        `;
        return res[0] ? res[0].id : null;
    },

    resetAllOrders: async () => {
        const sql = Database.getSql();
        if (!sql) return;
        try {
            await sql`DELETE FROM messages`;
            await sql`DELETE FROM orders`;
            return true;
        } catch (e) {
            console.error('❌ Erro ao resetar pedidos:', e.message);
            throw e;
        }
    },

    validatePassword: (password, hash) => bcrypt.compareSync(password, hash),

};

Database.init();
module.exports = Database;
