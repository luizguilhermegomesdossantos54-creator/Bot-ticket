require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    StringSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    UserSelectMenuBuilder,
    ChannelType, 
    PermissionFlagsBits,
    SlashCommandBuilder,
    REST,
    Routes,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags
} = require('discord.js');
const Database = require('better-sqlite3');
const db = new Database('tickets.db');

// =========================
// 🔹 BANCO DE DADOS
// =========================
db.prepare(`CREATE TABLE IF NOT EXISTS config (
    guildId TEXT PRIMARY KEY,
    cargoSuporteId TEXT,
    cargoFinanceiroId TEXT,
    categoriaId TEXT,
    canalLogsId TEXT,
    canalThreadsId TEXT,
    tipoTicket TEXT DEFAULT 'canal',
    embedTitulo TEXT DEFAULT '📩 Central de Atendimento',
    embedDescricao TEXT DEFAULT 'Selecione uma categoria abaixo para abrir um ticket.',
    embedCor TEXT DEFAULT '#5865F2',
    embedBanner TEXT,
    embedThumbnail TEXT,
    ticketTitulo TEXT DEFAULT '🎫 Atendimento Iniciado',
    ticketDescricao TEXT DEFAULT 'Olá {user}, descreva sua dúvida abaixo.\nUse o botão para finalizar o atendimento.',
    ticketBanner TEXT,
    ticketThumbnail TEXT,
    lastPanelMsgId TEXT,
    lastPanelChannelId TEXT
)`).run();

// Migração automática: Adiciona colunas se não existirem
const tableInfo = db.prepare("PRAGMA table_info(config)").all();
const columns = tableInfo.map(c => c.name);

if (!columns.includes('ticketTitulo')) {
    db.prepare("ALTER TABLE config ADD COLUMN ticketTitulo TEXT DEFAULT '🎫 Atendimento Iniciado'").run();
}
if (!columns.includes('ticketDescricao')) {
    db.prepare("ALTER TABLE config ADD COLUMN ticketDescricao TEXT DEFAULT 'Olá {user}, descreva sua dúvida abaixo.\nUse o botão para finalizar o atendimento.'").run();
}
if (!columns.includes('embedBanner')) {
    db.prepare("ALTER TABLE config ADD COLUMN embedBanner TEXT").run();
}
if (!columns.includes('embedThumbnail')) {
    db.prepare("ALTER TABLE config ADD COLUMN embedThumbnail TEXT").run();
}
if (!columns.includes('ticketBanner')) {
    db.prepare("ALTER TABLE config ADD COLUMN ticketBanner TEXT").run();
}
if (!columns.includes('ticketThumbnail')) {
    db.prepare("ALTER TABLE config ADD COLUMN ticketThumbnail TEXT").run();
}
if (!columns.includes('lastPanelMsgId')) {
    db.prepare("ALTER TABLE config ADD COLUMN lastPanelMsgId TEXT").run();
}
if (!columns.includes('lastPanelChannelId')) {
    db.prepare("ALTER TABLE config ADD COLUMN lastPanelChannelId TEXT").run();
}

db.prepare(`CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT,
    nome TEXT,
    emoji TEXT,
    descricao TEXT,
    cargoId TEXT
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS tickets_abertos (
    channelId TEXT PRIMARY KEY,
    userId TEXT,
    categoriaId TEXT,
    categoriaNome TEXT,
    abertoPorTag TEXT,
    atendenteId TEXT,
    lastMessageAt INTEGER
)`).run();

// Migração automática para tickets_abertos
const tableInfoTickets = db.prepare("PRAGMA table_info(tickets_abertos)").all();
const columnsTickets = tableInfoTickets.map(c => c.name);
if (!columnsTickets.includes('atendenteId')) {
    db.prepare("ALTER TABLE tickets_abertos ADD COLUMN atendenteId TEXT").run();
}
if (!columnsTickets.includes('lastMessageAt')) {
    db.prepare("ALTER TABLE tickets_abertos ADD COLUMN lastMessageAt INTEGER").run();
}

// Inserir categorias padrão se a tabela estiver vazia
const checkCats = db.prepare("SELECT count(*) as count FROM categorias WHERE guildId = 'GLOBAL'").get();
if (checkCats.count === 0) {
    const insert = db.prepare("INSERT INTO categorias (guildId, nome, emoji, descricao) VALUES ('GLOBAL', ?, ?, ?)");
    insert.run('Suporte Geral', '🛠️', 'Dúvidas e problemas técnicos');
    insert.run('Financeiro', '💰', 'Assuntos sobre pagamentos');
    insert.run('Denúncias', '🚫', 'Reportar algo errado');
}

function getConfig(guildId) {
    let config = db.prepare('SELECT * FROM config WHERE guildId = ?').get(guildId);
    if (!config) {
        db.prepare('INSERT INTO config (guildId) VALUES (?)').run(guildId);
        config = db.prepare('SELECT * FROM config WHERE guildId = ?').get(guildId);
    }
    return config;
}

function getCategorias(guildId) {
    return db.prepare("SELECT * FROM categorias WHERE guildId = ? OR guildId = 'GLOBAL'").all(guildId);
}

function updateConfig(guildId, key, value) {
    db.prepare(`UPDATE config SET ${key} = ? WHERE guildId = ?`).run(value, guildId);
}

// =========================
// 🔹 CONFIGURAÇÕES INICIAIS
// =========================
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});

// =========================
// 🔹 REGISTRO DE COMANDOS
// =========================
const commands = [
    new SlashCommandBuilder()
        .setName('setup-ticket')
        .setDescription('Envia o painel de abertura de tickets')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('config-ticket')
        .setDescription('Abre o menu de configurações do bot de tickets')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('⏳ Registrando comandos...');
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('✅ Comandos registrados!');
    } catch (error) {
        console.error(error);
    }
})();

// =========================
// 🔹 EVENTO: BOT ONLINE
// =========================
client.once('ready', () => {
    console.log(`🎫 Bot de Tickets Pro Online: ${client.user.tag}`);

    // Sistema de Auto-Close por Inatividade (Verifica a cada 30 minutos)
    setInterval(async () => {
        const tempoInatividade = 24 * 60 * 60 * 1000; // 24 horas em milissegundos
        const agora = Date.now();
        const ticketsInativos = db.prepare("SELECT * FROM tickets_abertos WHERE lastMessageAt < ?").all(agora - tempoInatividade);

        for (const ticket of ticketsInativos) {
            try {
                const guild = client.guilds.cache.get(GUILD_ID);
                if (!guild) continue;
                const canal = await guild.channels.fetch(ticket.channelId).catch(() => null);
                if (!canal) {
                    db.prepare("DELETE FROM tickets_abertos WHERE channelId = ?").run(ticket.channelId);
                    continue;
                }

                await canal.send({ content: "⚠️ **Aviso de Inatividade:** Este ticket será fechado em breve por falta de interação." });
                
                // Opcional: Fechar imediatamente ou agendar
                // Aqui vamos apenas avisar e deletar o registro para não avisar de novo, 
                // ou você pode chamar a função de fechar ticket aqui.
                // Para simplificar, vamos apenas avisar.
            } catch (e) { console.error("Erro no Auto-Close:", e); }
        }
    }, 30 * 60 * 1000);
});

// =========================
// 🔹 EVENTO: INTERAÇÕES
// =========================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    // Atualizar timestamp de última mensagem para o sistema de auto-close
    db.prepare("UPDATE tickets_abertos SET lastMessageAt = ? WHERE channelId = ?").run(Date.now(), message.channel.id);
});

client.on('interactionCreate', async (interaction) => {

    const config = getConfig(interaction.guildId);

    // --- COMANDOS SLASH ---
    if (interaction.isChatInputCommand()) {
        
        if (interaction.commandName === 'setup-ticket') {
            const categorias = getCategorias(interaction.guildId);
            const embed = new EmbedBuilder()
                .setTitle(config.embedTitulo)
                .setDescription(config.embedDescricao)
                .setColor(config.embedCor)
                .setImage(config.embedBanner || null)
                .setThumbnail(config.embedThumbnail || null)
                .setFooter({ text: 'Sistema de Tickets • ' + interaction.guild.name });

            const menu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('selecionar_categoria')
                    .setPlaceholder('Escolha uma categoria...')
                    .addOptions(categorias.map(cat => ({
                        label: cat.nome,
                        value: `cat_${cat.id}`,
                        emoji: cat.emoji || null,
                        description: cat.descricao || null
                    })))
            );

            await interaction.reply({ content: '✅ Painel enviado!', flags: [MessageFlags.Ephemeral] });
            await interaction.channel.send({ embeds: [embed], components: [menu] });
        }

        if (interaction.commandName === 'config-ticket') {
            enviarMenuConfig(interaction, config);
        }
    }

    // --- BOTÕES DE CONFIGURAÇÃO ---
    if (interaction.isButton()) {
        
        if (interaction.customId === 'config_embed') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('edit_embed_principal').setLabel('Painel Principal').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('edit_embed_interno').setLabel('Dentro do Ticket').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('voltar_config').setLabel('Voltar').setStyle(ButtonStyle.Secondary)
            );
            await interaction.update({ content: 'Qual embed você deseja editar?', embeds: [], components: [row] });
        }

        if (interaction.customId === 'edit_embed_principal') {
            const modal = new ModalBuilder().setCustomId('modal_embed_principal').setTitle('Editar Painel Principal');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_titulo').setLabel('Título').setValue(config.embedTitulo || '📩 Central de Atendimento').setStyle(TextInputStyle.Short)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_desc').setLabel('Descrição').setValue(config.embedDescricao || 'Selecione uma categoria abaixo para abrir um ticket.').setStyle(TextInputStyle.Paragraph)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_cor').setLabel('Cor (Hex)').setValue(config.embedCor || '#5865F2').setStyle(TextInputStyle.Short)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_banner').setLabel('URL do Banner (Opcional)').setValue(config.embedBanner || '').setStyle(TextInputStyle.Short).setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_thumb').setLabel('URL da Thumbnail (Opcional)').setValue(config.embedThumbnail || '').setStyle(TextInputStyle.Short).setRequired(false))
            );
            await interaction.showModal(modal);
        }

        if (interaction.customId === 'edit_embed_interno') {
            const modal = new ModalBuilder().setCustomId('modal_embed_interno').setTitle('Editar Embed do Ticket');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_titulo_tk').setLabel('Título').setValue(config.ticketTitulo || '🎫 Atendimento Iniciado').setStyle(TextInputStyle.Short)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_desc_tk').setLabel('Descrição ({user} p/ marcar)').setValue(config.ticketDescricao || 'Olá {user}, descreva sua dúvida abaixo.').setStyle(TextInputStyle.Paragraph)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_banner_tk').setLabel('URL do Banner (Opcional)').setValue(config.ticketBanner || '').setStyle(TextInputStyle.Short).setRequired(false)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_thumb_tk').setLabel('URL da Thumbnail (Opcional)').setValue(config.ticketThumbnail || '').setStyle(TextInputStyle.Short).setRequired(false))
            );
            await interaction.showModal(modal);
        }

        if (interaction.customId === 'config_tipo') {
            const novoTipo = config.tipoTicket === 'canal' ? 'thread' : 'canal';
            updateConfig(interaction.guildId, 'tipoTicket', novoTipo);
            const novaConfig = getConfig(interaction.guildId);
            await interaction.update(gerarEmbedConfig(interaction, novaConfig));
        }

        if (interaction.customId === 'config_cargos') {
            const rowSuporte = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId('select_cargo_suporte')
                    .setPlaceholder('Selecionar Cargo de Suporte Geral')
            );
            const rowFinanceiro = new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder()
                    .setCustomId('select_cargo_financeiro')
                    .setPlaceholder('Selecionar Cargo Financeiro')
            );
            const rowVoltar = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('voltar_config').setLabel('Voltar').setStyle(ButtonStyle.Secondary)
            );

            await interaction.update({ content: 'Selecione os cargos abaixo:', embeds: [], components: [rowSuporte, rowFinanceiro, rowVoltar] });
        }

        if (interaction.customId === 'config_canais') {
            const rowCategoria = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('select_categoria')
                    .setPlaceholder('Selecionar Categoria de Tickets')
                    .addChannelTypes(ChannelType.GuildCategory)
            );
            const rowLogs = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('select_logs')
                    .setPlaceholder('Selecionar Canal de Logs')
                    .addChannelTypes(ChannelType.GuildText)
            );
            const rowThreads = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('select_threads')
                    .setPlaceholder('Canal para Tópicos (se usar Threads)')
                    .addChannelTypes(ChannelType.GuildText)
            );
            const rowVoltar = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('voltar_config').setLabel('Voltar').setStyle(ButtonStyle.Secondary)
            );

            await interaction.update({ content: 'Selecione os canais abaixo:', embeds: [], components: [rowCategoria, rowLogs, rowThreads, rowVoltar] });
        }

        if (interaction.customId === 'config_categorias') {
            const categorias = getCategorias(interaction.guildId);
            const embed = new EmbedBuilder()
                .setTitle('📂 Gerenciar Categorias')
                .setDescription('Aqui você pode adicionar, remover ou editar as categorias de tickets.')
                .setColor('#5865F2');

            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('add_categoria').setLabel('Adicionar').setStyle(ButtonStyle.Success).setEmoji('➕'),
                new ButtonBuilder().setCustomId('voltar_config').setLabel('Voltar').setStyle(ButtonStyle.Secondary)
            );

            const components = [row1];

            if (categorias.length > 0) {
                const menuRemover = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('remover_categoria')
                        .setPlaceholder('Selecionar categoria para REMOVER')
                        .addOptions(categorias.map(cat => ({ label: cat.nome, value: cat.id.toString() })))
                );
                components.push(menuRemover);
            }

            await interaction.update({ content: null, embeds: [embed], components: components });
        }

        if (interaction.customId === 'add_categoria') {
            const modal = new ModalBuilder().setCustomId('modal_add_categoria').setTitle('Adicionar Categoria');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cat_nome').setLabel('Nome da Categoria').setPlaceholder('Ex: Suporte VIP').setStyle(TextInputStyle.Short)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cat_emoji').setLabel('Emoji').setPlaceholder('Ex: ⭐').setStyle(TextInputStyle.Short)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cat_desc').setLabel('Descrição').setPlaceholder('Ex: Atendimento prioritário').setStyle(TextInputStyle.Short))
            );
            await interaction.showModal(modal);
        }

        if (interaction.customId === 'voltar_config') {
            const novaConfig = getConfig(interaction.guildId);
            await interaction.update(gerarEmbedConfig(interaction, novaConfig));
        }

        if (interaction.customId === 'setar_painel') {
            const categorias = getCategorias(interaction.guildId);
            const embed = new EmbedBuilder()
                .setTitle(config.embedTitulo)
                .setDescription(config.embedDescricao)
                .setColor(config.embedCor)
                .setImage(config.embedBanner || null)
                .setThumbnail(config.embedThumbnail || null)
                .setFooter({ text: 'Sistema de Tickets • ' + interaction.guild.name });

            const menu = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('selecionar_categoria')
                    .setPlaceholder('Escolha uma categoria...')
                    .addOptions(categorias.map(cat => ({
                        label: cat.nome,
                        emoji: cat.emoji,
                        description: cat.descricao,
                        value: `cat_${cat.id}`
                    })))
            );

            const msg = await interaction.channel.send({ embeds: [embed], components: [menu] });
            updateConfig(interaction.guildId, 'lastPanelMsgId', msg.id);
            updateConfig(interaction.guildId, 'lastPanelChannelId', interaction.channelId);
            
            await interaction.reply({ content: '✅ Painel enviado com sucesso! Agora você pode usar o botão "Sincronizar" para atualizá-lo futuramente.', flags: [MessageFlags.Ephemeral] });
        }

        if (interaction.customId === 'sincronizar_painel') {
            if (!config.lastPanelMsgId || !config.lastPanelChannelId) {
                return interaction.reply({ content: '❌ Nenhum painel foi setado anteriormente para sincronizar.', flags: [MessageFlags.Ephemeral] });
            }

            try {
                const channel = await interaction.guild.channels.fetch(config.lastPanelChannelId);
                const message = await channel.messages.fetch(config.lastPanelMsgId);
                
                const categorias = getCategorias(interaction.guildId);
                const embed = new EmbedBuilder()
                    .setTitle(config.embedTitulo)
                    .setDescription(config.embedDescricao)
                    .setColor(config.embedCor)
                    .setImage(config.embedBanner || null)
                    .setThumbnail(config.embedThumbnail || null)
                    .setFooter({ text: 'Sistema de Tickets • ' + interaction.guild.name });

                const menu = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('selecionar_categoria')
                        .setPlaceholder('Escolha uma categoria...')
                        .addOptions(categorias.map(cat => ({
                            label: cat.nome,
                            emoji: cat.emoji,
                            description: cat.descricao,
                            value: `cat_${cat.id}`
                        })))
                );

                await message.edit({ embeds: [embed], components: [menu] });
                await interaction.reply({ content: '✅ Painel sincronizado e atualizado com sucesso!', flags: [MessageFlags.Ephemeral] });
            } catch (error) {
                console.error('[ERRO SINCRONIZAR]:', error);
                await interaction.reply({ content: '❌ Não foi possível encontrar ou editar a mensagem original. Tente usar "Setar Painel" novamente.', flags: [MessageFlags.Ephemeral] });
            }
        }

        if (interaction.customId === 'assumir_ticket') {
            const ticketInfo = db.prepare("SELECT * FROM tickets_abertos WHERE channelId = ?").get(interaction.channel.id);
            if (!ticketInfo) return interaction.reply({ content: '❌ Erro ao buscar informações do ticket.', flags: [MessageFlags.Ephemeral] });
            if (ticketInfo.atendenteId) return interaction.reply({ content: `❌ Este ticket já está sendo atendido por <@${ticketInfo.atendenteId}>`, flags: [MessageFlags.Ephemeral] });

            db.prepare("UPDATE tickets_abertos SET atendenteId = ? WHERE channelId = ?").run(interaction.user.id, interaction.channel.id);

            const embedOriginal = interaction.message.embeds[0];
            const novoEmbed = EmbedBuilder.from(embedOriginal).addFields({ name: 'Atendente', value: `${interaction.user}`, inline: true });
            
            const novosBotoes = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('assumir_ticket').setLabel('Ticket Assumido').setStyle(ButtonStyle.Success).setEmoji('✅').setDisabled(true),
                new ButtonBuilder().setCustomId('add_membro_ticket').setLabel('Adicionar Membros').setStyle(ButtonStyle.Secondary).setEmoji('➕'),
                new ButtonBuilder().setCustomId('painel_ferramentas').setLabel('Ferramentas').setStyle(ButtonStyle.Secondary).setEmoji('⚙️'),
                new ButtonBuilder().setCustomId('deletar_ticket').setLabel('Fechar Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
            );

            await interaction.update({ embeds: [novoEmbed], components: [novosBotoes] });
            await interaction.followUp({ content: `🙋‍♂️ O atendente ${interaction.user} assumiu este ticket!` });
        }

        if (interaction.customId === 'add_membro_ticket') {
            const row = new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId('select_membro_add')
                    .setPlaceholder('Selecione o membro para adicionar')
            );
            await interaction.reply({ content: 'Selecione abaixo quem você deseja adicionar ao ticket:', components: [row], flags: [MessageFlags.Ephemeral] });
        }

        if (interaction.customId === 'painel_ferramentas') {
            const embed = new EmbedBuilder()
                .setTitle('⚙️ Painel de Ferramentas')
                .setDescription('Selecione uma ação administrativa abaixo:')
                .setColor('#2F3136');

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('renomear_ticket').setLabel('Renomear').setStyle(ButtonStyle.Secondary).setEmoji('📝'),
                new ButtonBuilder().setCustomId('mudar_categoria_ticket').setLabel('Mudar Categoria').setStyle(ButtonStyle.Secondary).setEmoji('📂'),
                new ButtonBuilder().setCustomId('notificar_cliente').setLabel('Notificar Cliente').setStyle(ButtonStyle.Primary).setEmoji('🔔')
            );

            await interaction.reply({ embeds: [embed], components: [row], flags: [MessageFlags.Ephemeral] });
        }

        if (interaction.customId === 'renomear_ticket') {
            const modal = new ModalBuilder().setCustomId('modal_renomear_ticket').setTitle('Renomear Ticket');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('novo_nome').setLabel('Novo Nome do Canal').setPlaceholder('ex: suporte-vip').setStyle(TextInputStyle.Short))
            );
            await interaction.showModal(modal);
        }

        if (interaction.customId === 'mudar_categoria_ticket') {
            const categorias = getCategorias(interaction.guildId);
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('select_mudar_categoria')
                    .setPlaceholder('Selecione a nova categoria')
                    .addOptions(categorias.map(cat => ({ label: cat.nome, value: cat.id.toString(), emoji: cat.emoji })))
            );
            await interaction.reply({ content: 'Escolha a nova categoria para este ticket:', components: [row], flags: [MessageFlags.Ephemeral] });
        }

        if (interaction.customId === 'notificar_cliente') {
            const ticketInfo = db.prepare("SELECT * FROM tickets_abertos WHERE channelId = ?").get(interaction.channel.id);
            if (ticketInfo) {
                await interaction.channel.send({ content: `🔔 <@${ticketInfo.userId}>, um atendente está aguardando sua resposta!` });
                await interaction.reply({ content: '✅ Cliente notificado!', flags: [MessageFlags.Ephemeral] });
            }
        }

        if (interaction.customId === 'deletar_ticket') {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            try {
                const ticketInfo = db.prepare("SELECT * FROM tickets_abertos WHERE channelId = ?").get(interaction.channel.id);
                if (!ticketInfo) {
                    return interaction.editReply({ content: '❌ Não foi possível encontrar informações sobre este ticket.' });
                }

                const mensagens = await interaction.channel.messages.fetch({ limit: 100 });
                
                // Gerar HTML do Transcript Profissional
                let htmlContent = `
                <!DOCTYPE html>
                <html lang="pt-BR">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Transcript - ${interaction.channel.name}</title>
                    <style>
                        :root {
                            --bg-color: #313338;
                            --header-bg: #2b2d31;
                            --text-main: #dbdee1;
                            --text-muted: #949ba4;
                            --accent: #5865f2;
                            --border: #3f4147;
                        }
                        body { background-color: var(--bg-color); color: var(--text-main); font-family: 'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 0; }
                        .container { max-width: 900px; margin: 0 auto; padding: 40px 20px; }
                        .header { background: var(--header-bg); padding: 30px; border-radius: 12px; border-left: 5px solid var(--accent); margin-bottom: 30px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
                        .header h1 { margin: 0; color: #fff; font-size: 24px; }
                        .header-info { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 20px; font-size: 14px; }
                        .info-item { color: var(--text-muted); }
                        .info-item b { color: var(--text-main); }
                        .chat { display: flex; flex-direction: column; gap: 2px; }
                        .message-group { display: flex; padding: 10px 15px; border-radius: 8px; transition: background 0.2s; }
                        .message-group:hover { background: rgba(255,255,255,0.02); }
                        .avatar { width: 45px; height: 45px; border-radius: 50%; margin-right: 16px; flex-shrink: 0; }
                        .msg-content { flex: 1; }
                        .msg-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
                        .author { font-weight: 600; color: #fff; font-size: 16px; }
                        .timestamp { color: var(--text-muted); font-size: 12px; }
                        .text { line-height: 1.5; font-size: 15px; white-space: pre-wrap; word-break: break-word; }
                        .attachment { margin-top: 10px; padding: 10px; background: #2b2d31; border-radius: 4px; border: 1px solid var(--border); display: inline-block; color: var(--accent); text-decoration: none; font-size: 13px; }
                        .footer { text-align: center; margin-top: 50px; color: var(--text-muted); font-size: 12px; padding-bottom: 40px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>📄 Transcript de Atendimento</h1>
                            <div class="header-info">
                                <div class="info-item">Canal: <b>#${interaction.channel.name}</b></div>
                                <div class="info-item">Categoria: <b>${ticketInfo.categoriaNome}</b></div>
                                <div class="info-item">Aberto por: <b>${ticketInfo.abertoPorTag}</b></div>
                                <div class="info-item">Fechado por: <b>${interaction.user.tag}</b></div>
                                <div class="info-item">Data: <b>${new Date().toLocaleString('pt-BR')}</b></div>
                            </div>
                        </div>
                        <div class="chat">
                `;

                mensagens.reverse().forEach(m => {
                    const avatarUrl = m.author.displayAvatarURL({ extension: 'png', size: 128 });
                    const attachments = m.attachments.map(a => `<a href="${a.url}" class="attachment" target="_blank">📎 Ver Anexo (${a.name})</a>`).join('');
                    
                    htmlContent += `
                    <div class="message-group">
                        <img class="avatar" src="${avatarUrl}" alt="avatar">
                        <div class="msg-content">
                            <div class="msg-header">
                                <span class="author">${m.author.tag}</span>
                                <span class="timestamp">${m.createdAt.toLocaleString('pt-BR')}</span>
                            </div>
                            <div class="text">${m.content || ''}</div>
                            ${attachments}
                        </div>
                    </div>`;
                });

                htmlContent += `
                        </div>
                        <div class="footer">
                            Sistema de Tickets Profissional • Gerado em ${new Date().toLocaleDateString('pt-BR')}
                        </div>
                    </div>
                </body>
                </html>`;

                const canalLogsId = config.canalLogsId || process.env.CANAL_LOGS_ID;
                if (canalLogsId) {
                    const canalLogs = interaction.guild.channels.cache.get(canalLogsId);
                    if (canalLogs) {
                        // Primeiro enviamos apenas o arquivo para obter o link
                        const msgLogArquivo = await canalLogs.send({ 
                            files: [{ attachment: Buffer.from(htmlContent), name: `transcript-${interaction.channel.name}.html` }] 
                        });
                        
                        const urlTranscript = msgLogArquivo.attachments.first().url;

                        const logEmbed = new EmbedBuilder()
                            .setTitle(`Ticket Finalizado: ${interaction.channel.name}`)
                            .setColor(0xFF0000) // Vermelho para ticket fechado
                            .addFields(
                                { name: 'Fechado por', value: `${interaction.user.tag}`, inline: true },
                                { name: 'Aberto por', value: `${ticketInfo.abertoPorTag}`, inline: true },
                                { name: 'Categoria', value: `${ticketInfo.categoriaNome}`, inline: true }
                            )
                            .setTimestamp();

                        const logButton = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setLabel('Ver Transcript')
                                .setStyle(ButtonStyle.Link)
                                .setURL(urlTranscript)
                        );

                        // Enviamos o embed com o botão que leva ao link do arquivo
                        await canalLogs.send({
                            embeds: [logEmbed],
                            components: [logButton]
                        });
                    }
                }

                db.prepare("DELETE FROM tickets_abertos WHERE channelId = ?").run(interaction.channel.id);
                await interaction.editReply({ content: '✅ Ticket finalizado e log enviado. Este canal será deletado em 5 segundos.' });
                setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);

            } catch (e) {
                console.error(e);
                await interaction.editReply({ content: '❌ Ocorreu um erro ao finalizar o ticket.' });
            }
        }
    }

    // --- SELEÇÃO DE CARGOS/CANAIS/CATEGORIAS ---
    if (interaction.isRoleSelectMenu()) {
        if (interaction.customId === 'select_cargo_suporte') {
            updateConfig(interaction.guildId, 'cargoSuporteId', interaction.values[0]);
            await interaction.reply({ content: `✅ Cargo de Suporte atualizado para <@&${interaction.values[0]}>`, flags: [MessageFlags.Ephemeral] });
        }
        if (interaction.customId === 'select_cargo_financeiro') {
            updateConfig(interaction.guildId, 'cargoFinanceiroId', interaction.values[0]);
            await interaction.reply({ content: `✅ Cargo Financeiro atualizado para <@&${interaction.values[0]}>`, flags: [MessageFlags.Ephemeral] });
        }
    }

    if (interaction.isUserSelectMenu()) {
        if (interaction.customId === 'select_membro_add') {
            const userId = interaction.values[0];
            
            // Forçar o deferReply para evitar timeout enquanto processa permissões
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

            try {
                // Buscar o canal diretamente da API para garantir que o objeto esteja completo
                const channel = await interaction.guild.channels.fetch(interaction.channelId);
                
                if (!channel) {
                    return interaction.editReply({ content: '❌ Não foi possível encontrar o canal deste ticket.' });
                }

                // Verificar se o canal é uma Thread (Tópico) ou um Canal de Texto comum
                if (channel.isThread()) {
                    // Em Threads, apenas adicionamos o membro ao tópico
                    await channel.members.add(userId);
                    await interaction.editReply({ content: `✅ <@${userId}> foi adicionado ao tópico!` });
                    await channel.send({ content: `👥 <@${userId}> foi adicionado ao tópico por ${interaction.user}.` });
                } else {
                    // Em canais normais, usamos o sistema de permissões
                    await channel.permissionOverwrites.create(userId, {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true
                    });
                    await interaction.editReply({ content: `✅ <@${userId}> foi adicionado ao ticket!` });
                    await channel.send({ content: `👥 <@${userId}> foi adicionado à conversa por ${interaction.user}.` });
                }

            } catch (error) {
                console.error('[ERRO CRÍTICO ADD MEMBRO]:', error);
                await interaction.editReply({ 
                    content: '❌ Erro técnico ao adicionar membro. Certifique-se de que:\n1. O bot tem permissão de **Administrador**.\n2. O cargo do bot está no **topo da lista** de cargos.\n3. O canal não é um tópico (thread) se você estiver tentando usar permissões de canal de texto.' 
                });
            }
        }
    }

    if (interaction.isChannelSelectMenu()) {
        if (interaction.customId === 'select_categoria') {
            updateConfig(interaction.guildId, 'categoriaId', interaction.values[0]);
            await interaction.reply({ content: `✅ Categoria de tickets atualizada para <#${interaction.values[0]}>`, flags: [MessageFlags.Ephemeral] });
        }
        if (interaction.customId === 'select_logs') {
            updateConfig(interaction.guildId, 'canalLogsId', interaction.values[0]);
            await interaction.reply({ content: `✅ Canal de logs atualizado para <#${interaction.values[0]}>`, flags: [MessageFlags.Ephemeral] });
        }
        if (interaction.customId === 'select_threads') {
            updateConfig(interaction.guildId, 'canalThreadsId', interaction.values[0]);
            await interaction.reply({ content: `✅ Canal base para tópicos atualizado para <#${interaction.values[0]}>`, flags: [MessageFlags.Ephemeral] });
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'remover_categoria') {
            db.prepare("DELETE FROM categorias WHERE id = ? AND (guildId = ? OR guildId = 'GLOBAL')").run(interaction.values[0], interaction.guildId);
            
            const config = getConfig(interaction.guildId);
            await interaction.update(gerarEmbedConfig(interaction, config));
        }

        if (interaction.customId === 'select_mudar_categoria') {
            const catId = interaction.values[0];
            const categoriaObj = db.prepare('SELECT * FROM categorias WHERE id = ?').get(catId);
            if (categoriaObj) {
                db.prepare("UPDATE tickets_abertos SET categoriaId = ?, categoriaNome = ? WHERE channelId = ?").run(catId, categoriaObj.nome, interaction.channel.id);
                
                const embedOriginal = interaction.message.embeds[0];
                // Tentar atualizar o embed se possível (pode ser complexo dependendo de onde a interação veio)
                
                await interaction.reply({ content: `✅ Categoria do ticket alterada para **${categoriaObj.nome}**!`, flags: [MessageFlags.Ephemeral] });
                await interaction.channel.send({ content: `📂 A categoria deste ticket foi alterada para **${categoriaObj.nome}** por ${interaction.user}.` });
            }
        }
    }

    // --- MODAL SUBMIT ---
    if (interaction.isModalSubmit()) {
        try {
            if (interaction.customId === 'modal_renomear_ticket') {
                const novoNome = interaction.fields.getTextInputValue('novo_nome');
                await interaction.channel.setName(novoNome);
                await interaction.reply({ content: `✅ Canal renomeado para **${novoNome}**!`, flags: [MessageFlags.Ephemeral] });
            }

            if (interaction.customId === 'modal_embed_principal') {
                const titulo = interaction.fields.getTextInputValue('input_titulo');
                const desc = interaction.fields.getTextInputValue('input_desc');
                const cor = interaction.fields.getTextInputValue('input_cor');
                const banner = interaction.fields.getTextInputValue('input_banner');
                const thumb = interaction.fields.getTextInputValue('input_thumb');
                
                updateConfig(interaction.guildId, 'embedTitulo', titulo);
                updateConfig(interaction.guildId, 'embedDescricao', desc);
                updateConfig(interaction.guildId, 'embedCor', cor);
                updateConfig(interaction.guildId, 'embedBanner', banner);
                updateConfig(interaction.guildId, 'embedThumbnail', thumb);
                
                await interaction.reply({ content: '✅ Painel Principal atualizado com sucesso!', flags: [MessageFlags.Ephemeral] });
            }

            if (interaction.customId === 'modal_embed_interno') {
                const titulo = interaction.fields.getTextInputValue('input_titulo_tk');
                const desc = interaction.fields.getTextInputValue('input_desc_tk');
                const banner = interaction.fields.getTextInputValue('input_banner_tk');
                const thumb = interaction.fields.getTextInputValue('input_thumb_tk');
                
                updateConfig(interaction.guildId, 'ticketTitulo', titulo);
                updateConfig(interaction.guildId, 'ticketDescricao', desc);
                updateConfig(interaction.guildId, 'ticketBanner', banner);
                updateConfig(interaction.guildId, 'ticketThumbnail', thumb);
                
                await interaction.reply({ content: '✅ Embed interno do Ticket atualizado com sucesso!', flags: [MessageFlags.Ephemeral] });
            }

            if (interaction.customId === 'modal_add_categoria') {
                const nome = interaction.fields.getTextInputValue('cat_nome');
                const emoji = interaction.fields.getTextInputValue('cat_emoji');
                const desc = interaction.fields.getTextInputValue('cat_desc');
                
                db.prepare('INSERT INTO categorias (guildId, nome, emoji, descricao) VALUES (?, ?, ?, ?)').run(interaction.guildId, nome, emoji, desc);
                await interaction.reply({ content: `✅ Categoria **${nome}** adicionada com sucesso!`, flags: [MessageFlags.Ephemeral] });
            }
        } catch (error) {
            console.error('[ERRO MODAL]:', error);
            if (!interaction.replied) {
                await interaction.reply({ content: '❌ Ocorreu um erro ao salvar as configurações. Verifique o console.', flags: [MessageFlags.Ephemeral] });
            }
        }
    }

    // --- ABRIR TICKET (MENU SELECT) ---
    if (interaction.isStringSelectMenu() && interaction.customId === 'selecionar_categoria') {
        const catId = interaction.values[0].replace('cat_', '');
        const categoriaObj = db.prepare('SELECT * FROM categorias WHERE id = ?').get(catId);
        
        if (!categoriaObj) return interaction.reply({ content: '❌ Categoria não encontrada.', flags: [MessageFlags.Ephemeral] });

        const nomeCanal = `${categoriaObj.nome.toLowerCase().replace(/ /g, '-')}-${interaction.user.username}`;
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        try {
            let canalTicket;
            
            if (config.tipoTicket === 'thread') {
                const canalBaseId = config.canalThreadsId || interaction.channelId;
                const canalBase = interaction.guild.channels.cache.get(canalBaseId);
                canalTicket = await canalBase.threads.create({ name: nomeCanal, autoArchiveDuration: 1440, type: ChannelType.PrivateThread });
                await canalTicket.members.add(interaction.user.id);
            } else {
                const cargoSuporteId = categoriaObj.cargoId || config.cargoSuporteId || process.env.CARGO_SUPORTE_ID;
                canalTicket = await interaction.guild.channels.create({
                    name: nomeCanal,
                    type: ChannelType.GuildText,
                    parent: config.categoriaId || process.env.CATEGORIA_TICKETS_ID || null,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                        { id: cargoSuporteId || interaction.guild.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
                    ],
                });
            }

            const embed = new EmbedBuilder()
                .setTitle(config.ticketTitulo.replace('{categoria}', categoriaObj.nome.toUpperCase()))
                .setDescription(config.ticketDescricao.replace('{user}', `${interaction.user}`))
                .setColor(config.embedCor)
                .setImage(config.ticketBanner || null)
                .setThumbnail(config.ticketThumbnail || interaction.user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '👤 Cliente', value: `${interaction.user.tag}`, inline: true },
                    { name: '📂 Categoria', value: `${categoriaObj.nome}`, inline: true }
                )
                .setTimestamp();

            const botoes = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('assumir_ticket').setLabel('Assumir Ticket').setStyle(ButtonStyle.Success).setEmoji('🤝'),
                new ButtonBuilder().setCustomId('add_membro_ticket').setLabel('Adicionar Membros').setStyle(ButtonStyle.Secondary).setEmoji('➕'),
                new ButtonBuilder().setCustomId('painel_ferramentas').setLabel('Ferramentas').setStyle(ButtonStyle.Secondary).setEmoji('⚙️'),
                new ButtonBuilder().setCustomId('deletar_ticket').setLabel('Fechar Ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
            );

            let cargoMencao = categoriaObj.cargoId || config.cargoSuporteId || process.env.CARGO_SUPORTE_ID;
            if (categoriaObj.nome.toLowerCase().includes('financeiro') && config.cargoFinanceiroId) cargoMencao = config.cargoFinanceiroId;

            const mencaoTexto = cargoMencao ? `<@${interaction.user.id}> | <@&${cargoMencao}>` : `<@${interaction.user.id}>`;

            const msgTicket = await canalTicket.send({ content: mencaoTexto, embeds: [embed], components: [botoes] });
            
            // Marcar o usuário com uma mensagem separada para garantir a notificação (opcional, mas eficaz)
            await canalTicket.send({ content: `Olá ${interaction.user}, seu atendimento foi iniciado!` }).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));

            await interaction.editReply({ content: `✅ Seu ticket foi aberto: ${canalTicket}` });

            // Salvar informações do ticket na tabela tickets_abertos
            db.prepare("INSERT INTO tickets_abertos (channelId, userId, categoriaId, categoriaNome, abertoPorTag, lastMessageAt) VALUES (?, ?, ?, ?, ?, ?)").run(canalTicket.id, interaction.user.id, categoriaObj.id, categoriaObj.nome, interaction.user.tag, Date.now());

        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: '❌ Erro ao abrir ticket. Verifique as permissões do bot.' });
        }
    }
});

// --- FUNÇÕES AUXILIARES ---
function gerarEmbedConfig(interaction, config) {
    const categorias = getCategorias(interaction.guildId);
    const embed = new EmbedBuilder()
        .setTitle('⚙️ Configurações do Bot de Tickets')
        .setDescription('Personalize o bot usando os botões abaixo.')
        .addFields(
            { name: '📝 Embeds', value: `Principal: ${config.embedTitulo}\nInterno: ${config.ticketTitulo}`, inline: true },
            { name: '📁 Destino', value: `Tipo: ${config.tipoTicket === 'canal' ? 'Canais' : 'Tópicos (Threads)'}`, inline: true },
            { name: '📂 Categorias', value: categorias.map(c => `${c.emoji || ''} ${c.nome}`).join(', ') || 'Nenhuma', inline: false },
            { name: '👥 Cargos', value: `Suporte: <@&${config.cargoSuporteId || 'Não definido'}>\nFinanceiro: <@&${config.cargoFinanceiroId || 'Não definido'}>`, inline: false },
            { name: '📺 Canais', value: `Categoria: <#${config.categoriaId || 'Não definido'}>\nLogs: <#${config.canalLogsId || 'Não definido'}>`, inline: false }
        )
        .setColor('#5865F2');

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('config_embed').setLabel('Editar Embeds').setStyle(ButtonStyle.Primary).setEmoji('📝'),
        new ButtonBuilder().setCustomId('config_categorias').setLabel('Gerenciar Categorias').setStyle(ButtonStyle.Primary).setEmoji('📂'),
        new ButtonBuilder().setCustomId('config_tipo').setLabel('Mudar Destino').setStyle(ButtonStyle.Secondary).setEmoji('📁')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('config_cargos').setLabel('Configurar Cargos').setStyle(ButtonStyle.Secondary).setEmoji('👥'),
        new ButtonBuilder().setCustomId('config_canais').setLabel('Configurar Canais').setStyle(ButtonStyle.Secondary).setEmoji('📺')
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setar_painel').setLabel('Setar Painel').setStyle(ButtonStyle.Success).setEmoji('🚀'),
        new ButtonBuilder().setCustomId('sincronizar_painel').setLabel('Sincronizar').setStyle(ButtonStyle.Secondary).setEmoji('🔄').setDisabled(!config.lastPanelMsgId)
    );

    return { content: null, embeds: [embed], components: [row1, row2, row3], flags: [MessageFlags.Ephemeral] };
}

async function enviarMenuConfig(interaction, config) {
    await interaction.reply(gerarEmbedConfig(interaction, config));
}

client.login(TOKEN);
