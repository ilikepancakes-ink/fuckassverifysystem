import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, Interaction, Message, PermissionFlagsBits } from 'discord.js';
import express from 'express';
import multer from 'multer';
import * as crypto from 'crypto';
import db from './database';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const TOKEN = process.env.TOKEN!;

const commands = [
  new SlashCommandBuilder()
    .setName('createverifyembed')
    .setDescription('Create a verification embed')
    .addStringOption(option => option.setName('title').setDescription('Embed title').setRequired(true))
    .addStringOption(option => option.setName('description').setDescription('Embed description').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('verifychannelset')
    .setDescription('Set the verification channel')
    .addChannelOption(option => option.setName('channel').setDescription('Channel for verifications').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('setverifyedrole')
    .setDescription('Set the verified role')
    .addRoleOption(option => option.setName('role').setDescription('Verified role').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user!.tag}`);

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user!.id), {
      body: commands.map(cmd => cmd.toJSON()),
    });
    console.log('Commands registered');
  } catch (error) {
    console.error(error);
  }
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'createverifyembed') {
      const title = interaction.options.getString('title')!;
      const description = interaction.options.getString('description')!;

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(0x0099ff);

      const button = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('verify')
            .setLabel('Verify now')
            .setStyle(ButtonStyle.Primary)
        );

      await interaction.reply({ embeds: [embed], components: [button] });

      const message = await interaction.fetchReply() as Message;
      db.run('INSERT INTO embeds (guild_id, embed_id, title, description) VALUES (?, ?, ?, ?)',
        [interaction.guild!.id, message.id, title, description]);
    } else if (commandName === 'verifychannelset') {
      const channel = interaction.options.getChannel('channel')!;
      const guildId = interaction.guild!.id;

      // Ensure row exists
      db.run('INSERT OR IGNORE INTO settings (guild_id) VALUES (?)', [guildId]);
      // Update the column
      db.run('UPDATE settings SET verify_channel = ? WHERE guild_id = ?', [channel.id, guildId]);

      await interaction.reply({ content: `Verification channel set to ${channel}`, ephemeral: true });
    } else if (commandName === 'setverifyedrole') {
      const role = interaction.options.getRole('role')!;
      const guildId = interaction.guild!.id;

      // Ensure row exists
      db.run('INSERT OR IGNORE INTO settings (guild_id) VALUES (?)', [guildId]);
      // Update the column
      db.run('UPDATE settings SET verified_role = ? WHERE guild_id = ?', [role.id, guildId]);

      await interaction.reply({ content: `Verified role set to ${role}`, ephemeral: true });
    }
  } else if (interaction.isButton()) {
    if (interaction.customId === 'verify') {
      const random = crypto.randomBytes(16).toString('hex');
      const hashedUsername = crypto.createHash('sha256').update(interaction.user.username).digest('hex');

      db.run('INSERT INTO verifications (random, user_id, hashed_username, guild_id) VALUES (?, ?, ?, ?)',
        [random, interaction.user.id, hashedUsername, interaction.guild!.id]);

      const link = `http://verify.0x409.nl/verify/${random}/${hashedUsername}`;

      await interaction.reply({ content: `Click here to verify: ${link}`, ephemeral: true });
    } else if (interaction.customId.startsWith('approve_')) {
      const random = interaction.customId.split('_')[1];

      db.get('SELECT user_id FROM verifications WHERE random = ?', [random], (err, row: any) => {
        if (err || !row) return;

        const guild = interaction.guild!;
        const member = guild.members.cache.get(row.user_id);
        if (member) {
          db.get('SELECT verified_role FROM settings WHERE guild_id = ?', [guild.id], (err, setting: any) => {
            if (setting?.verified_role) {
              member.roles.add(setting.verified_role);
            }
          });
        }
        db.run('UPDATE verifications SET status = ? WHERE random = ?', ['approved', random]);
        interaction.update({ content: 'User verified!', components: [] });
      });
    } else if (interaction.customId.startsWith('decline_')) {
      const random = interaction.customId.split('_')[1];
      db.run('UPDATE verifications SET status = ? WHERE random = ?', ['declined', random]);
      interaction.update({ content: 'Verification declined.', components: [] });
    } else if (interaction.customId.startsWith('show_image_')) {
      const random = interaction.customId.split('_')[2];

      db.get('SELECT image_path, image_name FROM verifications WHERE random = ?', [random], (err, row: any) => {
        if (err || !row || !row.image_path) return;

        interaction.reply({ files: [{ attachment: row.image_path, name: row.image_name }], ephemeral: true });
      });
    }
  }
});

client.login(TOKEN);

// Express server for receiving images
const app = express();

app.post('/upload', multer({ dest: 'uploads/' }).single('image'), async (req, res) => {
  try {
    console.log('Upload request received:', req.body);

    const { random } = req.body;
    const file = req.file;

    if (!random || !file) {
      console.error('Missing data:', { random, file });
      return res.status(400).send('Missing data');
    }

    console.log('Querying database for verification:', random);
    const row = await new Promise<any>((resolve, reject) => {
      db.get('SELECT * FROM verifications WHERE random = ?', [random], (err, row) => {
        if (err) {
          console.error('Database error:', err);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });

    if (!row) {
      console.error('No verification found for random:', random);
      return res.status(400).send('Invalid');
    }

    if (row.status !== 'pending') {
      console.error('Verification not pending:', row.status);
      return res.status(400).send('Invalid');
    }

    console.log('Verification row:', row);

    const hashedUsername = row.hashed_username;
    const userId = row.user_id;

    // Check hashed matches
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) {
      console.error('Guild not found:', row.guild_id);
      return res.status(500).send('Guild not found');
    }

    console.log('Fetching member:', userId);
    const member = await guild.members.fetch(userId);
    if (!member) {
      console.error('Member not found:', userId);
      return res.status(400).send('User not found');
    }

    const currentHashed = crypto.createHash('sha256').update(member.user.username).digest('hex');
    if (currentHashed !== hashedUsername) {
      console.error('Username hash mismatch:', { current: currentHashed, stored: hashedUsername });
      return res.status(400).send('Username changed');
    }

    console.log('Hashes match, proceeding to send embed');

    // Send embed to verify channel
    console.log('Querying settings for guild:', guild.id);
    const setting = await new Promise<any>((resolve, reject) => {
      db.get('SELECT verify_channel FROM settings WHERE guild_id = ?', [guild.id], (err, setting) => {
        if (err) {
          console.error('Settings database error:', err);
          reject(err);
        } else {
          console.log('Settings query result:', setting);
          resolve(setting);
        }
      });
    });

    if (!setting?.verify_channel) {
      console.error('No verify channel set for guild:', guild.id, 'setting:', setting);
      return res.status(500).send('Verify channel not set');
    }

    const channel = guild.channels.cache.get(setting.verify_channel);
    if (!channel || !channel.isTextBased()) {
      console.error('Invalid verify channel:', setting.verify_channel);
      return res.status(500).send('Invalid verify channel');
    }

    const embed = new EmbedBuilder()
      .setTitle('Verification Request')
      .setDescription(`User: ${member}`)
      .setColor(0x00ff00);

    const buttons = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`approve_${random}`)
          .setLabel('Verify')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`decline_${random}`)
          .setLabel('Decline')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`show_image_${random}`)
          .setLabel('Show Image')
          .setStyle(ButtonStyle.Secondary)
      );

    console.log('Sending embed to channel:', channel.id);
    await channel.send({ embeds: [embed], components: [buttons] });

    // Store the image_path and image_name in db
    db.run('UPDATE verifications SET image_path = ?, image_name = ? WHERE random = ?', [file.path, file.originalname, random]);

    console.log('Embed sent successfully');
    res.send('Success! You may return to Discord.');
  } catch (error) {
    console.error('Error in /upload:', error);
    res.status(500).send('Internal server error');
  }
});

app.listen(4070, () => {
  console.log('Bot server listening on port 4070');
});
