require('dotenv').config(); 
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, PermissionsBitField } = require('discord.js');
const { google } = require('googleapis');
const nodemailer = require('nodemailer');

const sheets = google.sheets('v4');

const auth = new google.auth.GoogleAuth({
  keyFile: '',
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers, // Adicione esta linha para poder ouvir eventos de membros
  ],
});

const verificationCodes = {};
const assignedEmails = new Set();
const userCreatedChannels = new Map(); // Armazena canais criados pelos usuários

client.once('ready', () => {
  console.log(`Bot online como ${client.user.tag}`);
});

// Configurações do nodemailer
/// const transporter = nodemailer.createTransport({
///  service: 'gmail',
///  auth: {
///    user: '', 
///     pass: '', // Use um gerador de senhas ou um App Password
    // ou utilize outro serviço
///},
//});

//async function sendVerificationEmail(email, code) {
// const mailOptions = {
//    from: '',
///    to: email,
///    subject: 'Código de Verificação',
///    text: `Seu código de verificação é: ${code}`,
 // };

 // return transporter.sendMail(mailOptions);
//}

//async function checkUserEmail(email) {
  //const authClient = await auth.getClient();

  //const response = await sheets.spreadsheets.values.get({
   // auth: authClient,
   // spreadsheetId: '',
    // range: 'Sheet1!A1:B100',
 // });

  //const rows = response.data.values;
   //if (rows.length) {
    //for (const row of rows) {
     // if (row[0] === email) {
      //  return row[1]; 
      //}
   // }
  //}
 // return null; 
//}

client.on('messageCreate', async (message) => {
  if (message.content.startsWith('!verifyE')) {
    if (!message.guild) {
      return message.reply('Este comando só pode ser usado em um servidor.');
    }

    // Verifica se o usuário já criou um canal
    if (userCreatedChannels.has(message.author.id)) {
      return message.reply('Você já criou um canal de verificação. Por favor, use o existente ou aguarde ele ser excluído (5min).');
    }

    try {
      let channelName = 'verify-email';
      let counter = 1;

      // Verifica se um canal com o nome já existe e incrementa o número até encontrar um nome disponível
      while (message.guild.channels.cache.some(channel => channel.name === channelName)) {
        channelName = `verify-email-${counter}`;
        counter++;
      }

      console.log(`Tentando criar canal com o nome: ${channelName}`);

      // Configura as permissões do canal usando PermissionsBitField
      const channel = await message.guild.channels.create({
        name: channelName,
        topic: 'Canal para discussão sobre emails',
        nsfw: false,
        permissionOverwrites: [
          {
            id: message.guild.id, // ID do servidor
            deny: [PermissionsBitField.Flags.ViewChannel], // Negar a visualização para todos
          },
          {
            id: message.author.id, // ID do usuário que criou o canal
            allow: [PermissionsBitField.Flags.ViewChannel], // Permitir visualização para o usuário
          },
          {
            id: client.user.id, // ID do bot
            allow: [PermissionsBitField.Flags.ViewChannel], // Permitir visualização para o bot
          },
        ],
      });

      console.log(`Canal criado: ${channel.name}`);

      // Armazena o canal criado pelo usuário
      userCreatedChannels.set(message.author.id, channel.id);

      const button = new ButtonBuilder()
        .setCustomId('send_email_button')
        .setLabel('Enviar Email')
        .setStyle(ButtonStyle.Primary);

      const messageActionRow = new ActionRowBuilder().addComponents(button); 

      await channel.send({ content: 'Clique no botão abaixo para enviar seu e-mail:', components: [messageActionRow] });

      // Configura um timeout para deletar o canal após 5 minutos (300.000 ms)
      setTimeout(async () => {
        try {
          await channel.delete();
          console.log(`Canal "${channel.name}" excluído após 5 minutos.`);
          
          // Remove o canal do mapeamento
          userCreatedChannels.delete(message.author.id);
        } catch (err) {
          console.error('Erro ao excluir o canal:', err);
        }
      }, 300000); // 5 minutos

    } catch (error) {
      console.error('Erro ao criar canal:', error);
      message.reply('Houve um erro ao tentar criar o canal.');
    }
  }
});

// Evento para boas-vindas
client.on(Events.GuildMemberAdd, async (member) => {
  const welcomeChannel = member.guild.channels.cache.find(channel => channel.name === 'welcome');
  if (welcomeChannel) {
    await welcomeChannel.send(`Bem-vindo(a), <@${member.id}>! 🎉 Sinta-se à vontade para interagir e verificar seu Plano com !verifyE. `);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.customId === 'send_email_button') {
    await interaction.reply({ content: 'Por favor, envie seu e-mail:', ephemeral: true });

    const filter = (response) => response.author.id === interaction.user.id;
    const collector = interaction.channel.createMessageCollector({ filter, time: 30000 });

    collector.on('collect', async (response) => {
      const email = response.content;

      if (assignedEmails.has(email)) {
        return interaction.followUp('Este e-mail já está atribuído a um usuário.').catch(console.error);
      }

      const assinatura = await checkUserEmail(email);

      if (assinatura) {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await sendVerificationEmail(email, code);
        verificationCodes[interaction.user.id] = { code, email };

        await interaction.followUp('Um código de verificação foi enviado para seu e-mail. Por favor, envie o código para confirmar.').catch(console.error);
        collector.stop(); // Para o coletor de e-mail

        // Agora, crie um novo coletor para o código de verificação
        const codeCollector = interaction.channel.createMessageCollector({ filter, time: 30000 });

        codeCollector.on('collect', async (codeResponse) => {
          const userCode = codeResponse.content;

          if (userCode === verificationCodes[interaction.user.id]?.code) {
            await interaction.followUp('Código verificado com sucesso!').catch(console.error);
            
            // Adiciona o cargo ao usuário
            const role = interaction.guild.roles.cache.find(role => role.name === assinatura); // Altere para o nome do seu cargo
            if (role) {
              await interaction.member.roles.add(role);
              await interaction.followUp(`Cargo "${role.name}" adicionado ao usuário.`).catch(console.error);
            } else {
              await interaction.followUp('Cargo não encontrado.').catch(console.error);
            }

            assignedEmails.add(email); // Adiciona o e-mail ao conjunto de e-mails atribuídos

            // Tenta excluir o canal após a verificação
            try {
              await interaction.channel.delete();
              console.log(`Canal "${interaction.channel.name}" deletado com sucesso.`);
            } catch (err) {
              console.error('Erro ao deletar canal:', err);
            }
            codeCollector.stop(); // Para o coletor
          } else {
            await interaction.followUp('Código incorreto. Tente novamente.').catch(console.error);
          }
        });

        codeCollector.on('end', (collected) => {
          if (collected.size === 0) {
            interaction.followUp('Você não enviou um código a tempo.').catch(console.error);
          }
        });
      } else {
        await interaction.followUp('Email não encontrado na planilha.').catch(console.error);
      }
    });

    collector.on('end', (collected) => {
      if (collected.size === 0) {
        interaction.followUp('Você não enviou um e-mail a tempo.').catch(console.error);
      }
    });
  }
});

// Inicia o bot
//client.login(process.env.TOKEN); // Use a variável de ambiente para o token do bot
