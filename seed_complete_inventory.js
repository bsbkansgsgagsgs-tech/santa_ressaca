const db = require('./database');

async function seed() {
    console.log('🚀 Iniciando restauração completa do inventário...');

    const products = [
        // COMBOS
        {
            name: 'COMBO SEXTÔU INSANO',
            description: '1 Jack Daniels + 4 Energético Monster + 1 Gelo de Coco\n1 Cerveja Skol (Fardo)',
            price: 179.90,
            category: 'Combos',
            image_url: 'imagens/combo_sextou.png'
        },
        {
            name: 'COMBO CHURRAS GARANTIDO',
            description: '1 Caixa Skol 12 un + 1 Pão de Alho + 1 Carvão 3kg',
            price: 89.90,
            category: 'Combos',
            image_url: 'imagens/COMBO CHURRAS GARANTIDO.png'
        },
        {
            name: 'COMBO MAROMBA',
            description: '2 Energéticos + 1 Vodka Premium + Gelo de Fruta',
            price: 129.90,
            category: 'Combos',
            image_url: 'imagens/maromba.png'
        },

        // BEBIDAS
        {
            name: 'Cerveja Corona 330ml',
            description: 'Refrescante e gelada, a favorita do rolê.',
            price: 9.90,
            category: 'Bebidas',
            image_url: 'imagens/corona.jpg'
        },
        {
            name: 'Johnnie Walker Black Label',
            description: 'Whisky 12 anos, sabor intenso e defumado.',
            price: 175.00,
            category: 'Bebidas',
            image_url: 'imagens/Black-Label.jpg'
        },
        {
            name: 'Coca-Cola 2 Litros',
            description: 'Sabor original, super gelada.',
            price: 12.00,
            category: 'Bebidas',
            image_url: 'imagens/coca.jpg'
        },
        {
            name: 'Heineken Long Neck',
            description: 'A clássica cerveja premium holandesa.',
            price: 10.50,
            category: 'Bebidas',
            image_url: 'https://images.unsplash.com/photo-1618885472118-20c140c46763?q=80&w=800&auto=format&fit=crop'
        },

        // CONVENIÊNCIA / MERCADO
        {
            name: 'Saco de Gelo 5kg',
            description: 'Gelo filtrado de alta qualidade.',
            price: 15.00,
            category: 'Conveniência',
            image_url: 'imagens/gelo.jpg'
        },
        {
            name: 'Mix de Salgadinhos',
            description: 'Seleção dos melhores snacks: Doritos, Cheetos e Lays.',
            price: 18.00,
            category: 'Conveniência',
            image_url: 'imagens/mix_salgadinhos.png'
        },
        {
            name: 'Pão de Alho Especial',
            description: 'O acompanhamento perfeito para o seu churrasco.',
            price: 16.50,
            category: 'Conveniência',
            image_url: 'https://images.unsplash.com/photo-1573140247632-f8fd74997d5c?q=80&w=800&auto=format&fit=crop'
        },
        {
            name: 'Carvão Vegetal 3kg',
            description: 'Queima uniforme e longa duração.',
            price: 22.00,
            category: 'Conveniência',
            image_url: 'https://images.unsplash.com/photo-1591263128582-f4da4128919a?q=80&w=800&auto=format&fit=crop'
        }
    ];

    // Limpar produtos existentes para evitar duplicatas básicas (opcional, mas seguro nesta fase)
    // await db.getSql()`DELETE FROM products`;

    for (const p of products) {
        try {
            await db.createProduct(p);
            console.log(`✅ Produto "${p.name}" restaurado.`);
        } catch (e) {
            console.error(`❌ Erro ao restaurar "${p.name}":`, e.message);
        }
    }

    console.log('\n✨ Restauração finalizada com sucesso!');
    process.exit(0);
}

seed();
