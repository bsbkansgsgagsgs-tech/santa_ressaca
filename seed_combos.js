const db = require('./database');

async function seed() {
    console.log('Iniciando inclusão dos combos clássicos...');

    const combos = [
        {
            name: 'COMBO SEXTOU INSANO',
            description: '1 Jack Daniels + 4 Energético Monster + 1 Gelo de Coco',
            price: 159.90,
            category: 'combos',
            image_url: 'https://images.unsplash.com/photo-1592750475338-74b7b21085ab?q=80&w=800&auto=format&fit=crop'
        },
        {
            name: 'COMBO CHURRAS GARANTIDO',
            description: '1 Caixa Skol 12 un + 1 Pão de Alho + 1 Carvão 3kg',
            price: 89.90,
            category: 'combos',
            image_url: 'https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=800&auto=format&fit=crop'
        }
    ];

    for (const p of combos) {
        try {
            await db.createProduct(p);
            console.log(`✅ Combo "${p.name}" adicionado.`);
        } catch (e) {
            console.error(`❌ Erro ao adicionar "${p.name}":`, e.message);
        }
    }

    console.log('Seeding finalizado.');
    process.exit(0);
}

seed();
