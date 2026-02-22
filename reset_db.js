const db = require('./database');
async function reset() {
    const sql = db.getSql();
    if (!sql) return;
    try {
        await sql`DELETE FROM messages`;
        await sql`DELETE FROM orders`;
        console.log('✅ Relatórios e pedidos zerados!');
    } catch (e) {
        console.error('❌ Erro ao zerar:', e);
    }
    process.exit(0);
}
reset();
