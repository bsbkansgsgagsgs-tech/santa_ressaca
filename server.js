require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const mercadopago = require('mercadopago');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3005;

// WhatsApp Client Initialization
const puppeteerOptions = {
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
    ],
};

// Usa o Chromium do sistema se disponível (necessário no Railway/Linux)
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerOptions,
});

let qrCodeData = null;
let whatsappStatus = 'DISCONNECTED';

client.on('qr', (qr) => {
    qrCodeData = qr;
    whatsappStatus = 'QR_CODE';
    console.log('[WhatsApp] QR Code gerado.');
    io.emit('whatsapp_qr', qr);
});

client.on('ready', () => {
    whatsappStatus = 'CONNECTED';
    qrCodeData = null;
    console.log('[WhatsApp] Cliente pronto!');
    io.emit('whatsapp_status', 'CONNECTED');
});

client.on('authenticated', () => {
    console.log('[WhatsApp] Autenticado!');
});

client.on('auth_failure', (msg) => {
    console.error('[WhatsApp] Falha na autenticação:', msg);
    whatsappStatus = 'FAILURE';
});

client.on('disconnected', (reason) => {
    whatsappStatus = 'DISCONNECTED';
    console.log('[WhatsApp] Desconectado:', reason);
    io.emit('whatsapp_status', 'DISCONNECTED');
    client.initialize(); // Tenta reconectar
});

client.on('message', async (msg) => {
    try {
        const fromNumber = msg.from; // Formato 555199999999@c.us
        if (!fromNumber.endsWith('@c.us')) return;

        const cleanPhone = fromNumber.replace(/\D/g, '');
        console.log(`[WhatsApp] Mensagem recebida de ${cleanPhone}: ${msg.body}`);

        // Tenta achar um pedido ativo desse telefone
        const orderId = await db.findOrderIdByPhone(cleanPhone);
        if (orderId) {
            // Salva no banco como mensagem do 'customer'
            const savedMsg = await db.createMessage(orderId, 'customer', msg.body);
            // Emite via socket para o dashboard
            io.emit('novo_chat_msg', { order_id: orderId, ...savedMsg });
            console.log(`[WhatsApp] Mensagem vinculada ao pedido #${orderId}`);
        }
    } catch (e) {
        console.error('[WhatsApp] Erro ao processar mensagem recebida:', e.message);
    }
});

client.initialize();

// Helper para enviar WhatsApp
async function sendWhatsAppMessage(phone, text) {
    if (!phone || whatsappStatus !== 'CONNECTED') {
        if (!phone) console.warn('[WhatsApp] Telefone vazio. Pulando.');
        return;
    }

    try {
        let cleanNumber = phone.replace(/\D/g, '');
        // Garante o código do país 55 para números brasileiros (10 ou 11 dígitos)
        if (cleanNumber.length >= 10 && cleanNumber.length <= 11 && !cleanNumber.startsWith('55')) {
            cleanNumber = '55' + cleanNumber;
        }

        console.log(`[WhatsApp] Resolvendo ID para: ${cleanNumber}`);
        let numberId = await client.getNumberId(cleanNumber);

        // Fallback para o dígito 9 no Brasil (Diferença entre JID legados e novos)
        if (!numberId && cleanNumber.startsWith('55') && cleanNumber.length === 13) {
            const legacyNumber = cleanNumber.slice(0, 4) + cleanNumber.slice(5); // Remove o 9 após o DDD
            console.log(`[WhatsApp] Tentando fallback sem o 9º dígito: ${legacyNumber}`);
            numberId = await client.getNumberId(legacyNumber);
        }

        if (numberId) {
            const jid = numberId._serialized;
            console.log(`[WhatsApp] ID Resolvido: ${jid}. Enviando...`);
            await client.sendMessage(jid, text);
            console.log(`[WhatsApp] ✅ MENSAGEM ENVIADA para ${jid}`);
        } else {
            console.warn(`[WhatsApp] ❌ Erro: O número ${cleanNumber} não foi encontrado no WhatsApp (No LID).`);
        }
    } catch (e) {
        console.error(`[WhatsApp] 🛑 ERRO Crítico no envio para ${phone}:`, e.message);
    }
}

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Configurações de Sessão
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'santa_ressaca_temp_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
};

const adminSession = session({ ...sessionConfig, name: 'santa_admin_sid' });
const customerSession = session({ ...sessionConfig, name: 'santa_customer_sid' });

// Socket.io connection handling
io.on('connection', (socket) => {
    // Se o cliente já tiver um QR, envia para quem acabou de conectar
    if (qrCodeData) socket.emit('whatsapp_qr', qrCodeData);
    socket.emit('whatsapp_status', whatsappStatus);

    // Entrada em salas específicas
    socket.on('join_room', (room) => {
        socket.join(room);
        console.log(`[Socket] Cliente entrou na sala: ${room}`);
    });
});

// Middleware de proteção Admin
const requireAdmin = (req, res, next) => {
    if (req.session.adminId) {
        next();
    } else {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Sessão expirada. Por favor, faça login novamente.' });
        }
        res.redirect('/admin-login.html');
    }
};

// Retirada proteção de entregador

// Routes
app.get('/api/ping', (req, res) => res.json({ status: 'online', time: new Date().toISOString() }));

app.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-login.html'));
});

app.post('/api/admin/login', adminSession, async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await db.findUserByEmail(email);

        if (user && db.validatePassword(password, user.password) && user.is_admin) {
            req.session.adminId = user.id;
            req.session.adminName = user.name;
            req.session.isAdmin = true;

            res.json({ message: 'Login admin realizado!', redirect: '/dashboard' });
        } else {
            res.status(401).json({ error: 'Acesso negado.' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Erro no servidor.' });
    }
});

app.get('/dashboard', adminSession, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Endpoint registrar-entregador removido

app.post('/api/register', customerSession, async (req, res) => {
    try {
        const { name, email, password, phone } = req.body;
        if (!name || !email || !password || !phone) {
            return res.status(400).json({ error: 'Preencha todos os campos, incluindo o WhatsApp.' });
        }
        const user = await db.createUser(name, email, password, phone);
        req.session.userId = user.id;
        req.session.userName = user.name;
        req.session.userEmail = user.email;
        req.session.userPhone = user.phone;
        res.status(201).json({ message: 'Usuário criado com sucesso!', user: { name: user.name, email: user.email } });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/login', customerSession, async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await db.findUserByEmail(email);

        if (user && db.validatePassword(password, user.password)) {
            req.session.userId = user.id;
            req.session.userName = user.name;
            req.session.userEmail = user.email;
            req.session.userPhone = user.phone;
            res.json({ message: 'Login realizado com sucesso!', user: { name: user.name, email: user.email } });
        } else {
            res.status(401).json({ error: 'E-mail ou senha inválidos.' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Erro no servidor.' });
    }
});

app.get('/api/me', customerSession, async (req, res) => {
    if (req.session.userId) {
        res.json({
            loggedIn: true,
            user: {
                id: req.session.userId,
                name: req.session.userName,
                email: req.session.userEmail,
                phone: req.session.userPhone,
                is_admin: req.session.adminId ? true : false
            }
        });
    } else {
        res.json({ loggedIn: false });
    }
});

app.get('/api/admin/logout', adminSession, (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Erro ao destruir sessão admin:', err);
        res.redirect('/admin-login.html');
    });
});

app.get('/api/logout', customerSession, (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Erro ao destruir sessão cliente:', err);
        res.redirect('/');
    });
});

// Pedidos Real-Time
// API DE PEDIDOS - ADMIN (Sessão Admin)
app.get('/api/admin/orders', adminSession, requireAdmin, async (req, res) => {
    const { status } = req.query;
    try {
        const orders = await db.getOrders(status);
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar pedidos.' });
    }
});

// API DE PEDIDOS - CLIENTE (Sessão Cliente)
app.get('/api/orders', customerSession, async (req, res) => {
    try {
        if (req.session.userId) {
            const orders = await db.getUserOrders(req.session.userId);
            return res.json(orders);
        }
        res.status(401).json({ error: 'Não autorizado.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar pedidos.' });
    }
});

app.post('/api/orders', customerSession, async (req, res) => {
    try {
        const { customer_name, customer_phone, items, total, delivery_address } = req.body;

        const orderData = {
            customer_id: req.session.userId,
            customer_name: customer_name || (req.session.userName || 'Visitante'),
            customer_phone: req.session.userPhone || customer_phone, // Prioriza o do login
            items,
            total,
            delivery_address
        };

        const settings = await db.getSettings();

        // Bloqueio se a loja estiver fechada
        if (settings.store_status === 'fechada') {
            console.warn('[API] Tentativa de pedido com LOJA FECHADA.');
            return res.status(403).json({ error: 'Desculpe, a loja está fechada no momento. Confira nossos horários de atendimento!' });
        }

        const order = await db.createOrder(orderData);

        // Emitir evento para o dashboard
        io.emit('novo_pedido', order);

        // Notificação WhatsApp Novo Pedido
        if (order.customer_phone) {
            sendWhatsAppMessage(order.customer_phone,
                `*Santa Ressaca 🎅*\n\nOlá ${order.customer_name}! Recebemos seu pedido (#${order.id}).\nStatus: *Pendente*\n\nEstamos processando seu pedido e logo traremos novidades! 🚀`
            );
        }

        res.status(201).json(order);
    } catch (error) {
        console.error('Erro ao salvar pedido:', error.message);
        res.status(500).json({ error: 'Erro ao processar pedido.' });
    }
});

app.put('/api/admin/orders/:id', adminSession, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, delivery_user_id } = req.body;

        console.log(`[API] Pedido #${id}: ${status}`);

        let order = await db.updateOrderStatus(id, status);

        // Emitir evento para o cliente e dashboard
        io.emit('pedido_atualizado', order);
        // Notificação WhatsApp Mudança de Status
        if (order.customer_phone) {
            let msg = '';
            // Ajustado para bater com os nomes enviados pelo Dashboard
            if (status === 'em_preparo') msg = `✅ *PEDIDO EM PREPARO!* 👨‍🍳🔥\n\nSanta Ressaca informa: Seu pedido (#${order.id}) já está sendo preparado com todo cuidado. Logo sai para entrega! 🥃`;
            if (status === 'saiu_entrega') msg = `🛵 *PEDIDO A CAMINHO!* 💨🥃\n\nBoas notícias! Seu pedido (#${order.id}) acabou de sair para entrega. Fique atento ao seu portão/celular! 🏃‍♂️⚡️`;
            if (status === 'entregue') msg = `🏁 *PEDIDO ENTREGUE!* 🍻🥃\n\nOpa! Seu pedido (#${order.id}) consta como entregue. Aproveite sua resenha e obrigado pela preferência! 🎅🙌\n\n_Avalie-nos no Google se curtiu!_ ⭐`;
            if (status === 'cancelado') msg = `⚠️ *PEDIDO CANCELADO* 🛑\n\nOlá, seu pedido (#${order.id}) infelizmente foi cancelado. Para saber o motivo ou refazer, fale conosco aqui! 📲`;

            if (msg) {
                console.log(`[WhatsApp] Notificação Premium para #${id} (${status}) para ${order.customer_phone}`);
                sendWhatsAppMessage(order.customer_phone, msg);
            }
        } else {
            console.warn(`[WhatsApp] Pedido #${id} atualizado mas NÃO possui telefone cadastrado.`);
        }

        res.json(order);
    } catch (error) {
        console.error('Erro ao atualizar pedido:', error.message);
        res.status(500).json({ error: 'Erro ao atualizar pedido.' });
    }
});

// CHAT API - ADMIN
app.get('/api/admin/orders/:id/messages', adminSession, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const messages = await db.getMessages(id);
        res.json(messages);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/orders/:id/messages', adminSession, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { sender_role, message } = req.body;
        const msg = await db.createMessage(id, sender_role, message);

        if (sender_role === 'admin') {
            const order = await db.getOrderById(id);
            if (order && order.customer_phone) {
                await sendWhatsAppMessage(order.customer_phone, message);
            }
        }
        io.emit('novo_chat_msg', { order_id: id, ...msg });
        res.status(201).json(msg);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// CHAT API - CLIENTE
app.get('/api/orders/:id/messages', customerSession, async (req, res) => {
    try {
        const { id } = req.params;
        const messages = await db.getMessages(id);
        res.json(messages);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders/:id/messages', customerSession, async (req, res) => {
    try {
        const { id } = req.params;
        const { sender_role, message } = req.body;
        const msg = await db.createMessage(id, sender_role, message);
        io.emit('novo_chat_msg', { order_id: id, ...msg });
        res.status(201).json(msg);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ADMIN API - GESTÃO
app.get('/api/admin/stats', adminSession, requireAdmin, async (req, res) => {
    try {
        const stats = await db.getStats();
        res.json(stats);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/products', adminSession, requireAdmin, async (req, res) => {
    try {
        const prod = await db.getProducts();
        res.json(prod);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/products', adminSession, requireAdmin, async (req, res) => {
    try {
        const prod = await db.createProduct(req.body);
        res.status(201).json(prod);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/products/:id', adminSession, requireAdmin, async (req, res) => {
    try {
        const prod = await db.updateProduct(req.params.id, req.body);
        res.json(prod);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/products/:id', adminSession, requireAdmin, async (req, res) => {
    try {
        await db.deleteProduct(req.params.id);
        res.json({ message: 'Produto excluído.' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUBLIC API
app.get('/api/products', customerSession, async (req, res) => {
    try {
        const prod = await db.getProducts();
        // Filtra apenas os ativos para o público
        res.json(prod.filter(p => p.is_active));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/settings', adminSession, requireAdmin, async (req, res) => {
    try {
        const settings = await db.getSettings();
        res.json(settings);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/settings', adminSession, requireAdmin, async (req, res) => {
    try {
        const { key, value } = req.body;
        const s = await db.updateSetting(key, value);

        // Emitir mudança de status ou tempo para todos (Cliente e Dash)
        if (key === 'store_status') io.emit('store_status_changed', value);
        if (key === 'delivery_time') io.emit('delivery_time_changed', value);
        if (key === 'operation_hours') io.emit('operation_hours_changed', value);

        res.json(s);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/whatsapp/logout', adminSession, requireAdmin, async (req, res) => {
    try {
        await client.logout();
        whatsappStatus = 'DISCONNECTED';
        io.emit('whatsapp_status', 'DISCONNECTED');
        res.json({ message: 'WhatsApp desconectado.' });
        client.initialize();
    } catch (e) {
        res.status(500).json({ error: 'Erro ao desconectar WhatsApp: ' + e.message });
    }
});

// Endpoints de entrega removidos

// MERCADO PAGO INTEGRATION
app.post('/api/payments/create-preference', customerSession, async (req, res) => {
    try {
        const { orderId } = req.body;
        console.log(`[MercadoPago] Criando preferência para pedido #${orderId}`);
        const order = await db.getOrderById(orderId);
        if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

        const settings = await db.getSettings();
        const mpToken = settings.mp_access_token;

        if (!mpToken) {
            console.warn('[MercadoPago] Access Token ausente nas configurações.');
            return res.status(400).json({ error: 'Mercado Pago não configurado. Fale com o suporte.' });
        }

        const mpClient = new mercadopago.MercadoPagoConfig({ accessToken: mpToken });
        const preference = new mercadopago.Preference(mpClient);

        const response = await preference.create({
            body: {
                items: [
                    {
                        id: order.id.toString(),
                        title: `Pedido #${order.id} - Santa Ressaca`,
                        unit_price: Number(order.total),
                        quantity: 1,
                        currency_id: 'BRL'
                    }
                ],
                back_urls: {
                    success: `${req.protocol}://${req.get('host')}/index.html?payment=success&orderId=${order.id}`,
                    failure: `${req.protocol}://${req.get('host')}/index.html?payment=failure&orderId=${order.id}`,
                    pending: `${req.protocol}://${req.get('host')}/index.html?payment=pending&orderId=${order.id}`
                },
                auto_return: 'approved',
                notification_url: `https://${req.get('host')}/api/payments/webhook`,
                external_reference: order.id.toString()
            }
        });

        console.log(`[MercadoPago] Preferência criada: ${response.id}`);
        res.json({ id: response.id, init_point: response.init_point });
    } catch (error) {
        console.error('[MercadoPago] Erro Crítico:', error.message);
        res.status(500).json({ error: 'Erro ao processar pagamento com Mercado Pago.' });
    }
});

// WEBHOOK MERCADO PAGO
app.post('/api/payments/webhook', async (req, res) => {
    try {
        const { query } = req;
        const topic = query.topic || query.type;
        console.log(`[MercadoPago] Webhook: ${topic}`);

        if (topic === 'payment') {
            const paymentId = query.id || query['data.id'];
            const settings = await db.getSettings();
            const mpToken = settings.mp_access_token;
            if (!mpToken) return res.sendStatus(400);

            const mpClient = new mercadopago.MercadoPagoConfig({ accessToken: mpToken });
            const payment = new mercadopago.Payment(mpClient);
            const payData = await payment.get({ id: paymentId });
            const orderId = payData.external_reference;

            if (payData.status === 'approved') {
                const sql = db.getSql();
                await sql`UPDATE orders SET payment_status = 'pago' WHERE id = ${orderId}`;
                const updatedOrder = await db.getOrderById(orderId);
                io.emit('pedido_atualizado', updatedOrder);
                if (updatedOrder.customer_phone) {
                    sendWhatsAppMessage(updatedOrder.customer_phone, `✅ *PAGAMENTO CONFIRMADO!* 🍻\n\nRecebemos seu pagamento (#${orderId}). Seu pedido está em preparo!`);
                }
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('[MercadoPago Webhook] Erro:', error.message);
        res.sendStatus(500);
    }
});

server.listen(PORT, () => {
    console.log(`🚀 SERVIDOR REAL-TIME EM: http://localhost:${PORT}`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        process.exit(1);
    }
});
