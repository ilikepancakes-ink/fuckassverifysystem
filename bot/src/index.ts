import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, Interaction, Message, PermissionFlagsBits } from 'discord.js';
import express from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
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

      db.run('INSERT OR REPLACE INTO settings (guild_id, verify_channel) VALUES (?, ?)',
        [interaction.guild!.id, channel.id]);

      await interaction.reply({ content: `Verification channel set to ${channel}`, ephemeral: true });
    } else if (commandName === 'setverifyedrole') {
      const role = interaction.options.getRole('role')!;

      db.run('INSERT OR REPLACE INTO settings (guild_id, verified_role) VALUES (?, ?)',
        [interaction.guild!.id, role.id]);

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
    }
  }
});

client.login(TOKEN);

// Express server for receiving images
const app = express();
const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.single('image'), async (req, res) => {
  const { random } = req.body;
  const file = req.file;

  if (!random || !file) return res.status(400).send('Missing data');

  const row = await new Promise<any>((resolve, reject) => {
    db.get('SELECT * FROM verifications WHERE random = ?', [random], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

  if (!row || row.status !== 'pending') return res.status(400).send('Invalid');

  const hashedUsername = row.hashed_username;
  const userId = row.user_id;

  // Check hashed matches
  const guild = client.guilds.cache.get(row.guild_id);
  if (!guild) return res.status(500).send('Guild not found');

  const member = await guild.members.fetch(userId);
  if (!member) return res.status(400).send('User not found');

  const currentHashed = crypto.createHash('sha256').update(member.user.username).digest('hex');
  if (currentHashed !== hashedUsername) return res.status(400).send('Username changed');

  // Send embed to verify channel
  const setting = await new Promise<any>((resolve, reject) => {
    db.get('SELECT verify_channel FROM settings WHERE guild_id = ?', [guild.id], (err, setting) => {
      if (err) reject(err);
      else resolve(setting);
    });
  });

  if (setting?.verify_channel) {
    const channel = guild.channels.cache.get(setting.verify_channel);
    if (channel && channel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle('Verification Request')
        .setDescription(`User: ${member}`)
        .setImage(`attachment://${file.filename}`)
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
            .setStyle(ButtonStyle.Danger)
        );

      await channel.send({ embeds: [embed], components: [buttons], files: [{ attachment: file.path, name: file.filename }] });
    }
  }

  res.send('Success! You may return to Discord.');
});

app.listen(4070, () => {
  console.log('Bot server listening on port 4070');
});
