require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const path = require('path');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// 현재 타이머가 진행 중인 유저를 추적하기 위한 Map
const activeTimers = new Map();

// 유저별 오디오 설정 저장 Map
const userAudioSettings = new Map();

const AUDIO_DIR = path.join(__dirname, 'audio');
if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR);
}

// -----------------------------------------------------------------------------------------
// 슬래시 커맨드 정의 (Slash Commands)
// -----------------------------------------------------------------------------------------
const commands = [
    new SlashCommandBuilder()
        .setName('시작')
        .setDescription('뽀모도로 타이머를 시작합니다.')
        .addIntegerOption(option =>
            option.setName('집중시간')
                .setDescription('집중할 시간을 분 단위로 입력하세요 (기본 25분)')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('휴식시간')
                .setDescription('휴식할 시간을 분 단위로 입력하세요 (기본 5분)')
                .setRequired(false)),
    new SlashCommandBuilder()
        .setName('배경음')
        .setDescription('집중 시간에 재생할 배경음을 설정합니다.')
        .addStringOption(option =>
            option.setName('파일명')
                .setDescription('재생할 오디오 파일명 (예: bgm.mp3), 입력하지 않으면 켬/끔 토글')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('알림음')
        .setDescription('휴식/집중 종료 시 재생할 알림음을 설정합니다.')
        .addStringOption(option =>
            option.setName('파일명')
                .setDescription('재생할 오디오 파일명 (기본: notify.mp3)')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('목록')
        .setDescription('사용 가능한 오디오 목록을 확인합니다.'),
    new SlashCommandBuilder()
        .setName('중지')
        .setDescription('현재 진행 중인 뽀모도로 타이머를 중지합니다.'),
    new SlashCommandBuilder()
        .setName('도움말')
        .setDescription('뽀모도로 봇 사용법 안내를 출력합니다.')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// -----------------------------------------------------------------------------------------
// 봇 로직
// -----------------------------------------------------------------------------------------
client.on('ready', async () => {
    console.log(`✅ ${client.user.tag} 봇이 성공적으로 로그인했습니다!`);

    try {
        console.log('🔄 슬래시 커맨드 업데이트 중...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ 슬래시 커맨드가 성공적으로 등록되었습니다.');
    } catch (error) {
        console.error('❌ 슬래시 커맨드 등록 오류:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // '/도움말'
    if (commandName === '도움말') {
        return interaction.reply({
            content: `🍅 **뽀모도로 봇 사용법 안내** 🍅

🔹 \`/시작 [집중시간] [휴식시간]\`
타이머를 시작합니다. (옵션을 주지 않으면 기본값인 **집중 25분 / 휴식 5분** 적용)

🔹 \`/배경음 [파일명]\`
집중 시간에 반복 재생될 배경음을 설정합니다. (무음 원할 경우 \`없음\` 기입)
    
🔹 \`/알림음 [파일명]\`
타이머가 끝날 때 재생될 알림음을 설정합니다. (기본: \`notify.mp3\`)

🔹 \`/목록\`
사용 가능한 오디오 파일 목록을 확인합니다.

🔹 \`/중지\`
진행 중인 타이머를 즉시 중지하고 봇을 내보냅니다.`,
            ephemeral: true
        });
    }

    // '/목록'
    if (commandName === '목록') {
        fs.readdir(AUDIO_DIR, (err, files) => {
            if (err) {
                console.error(err);
                return interaction.reply({ content: '❌ 오디오 목록을 불러오는데 실패했습니다.', ephemeral: true });
            }
            const mp3Files = files.filter(f => f.endsWith('.mp3'));
            if (mp3Files.length === 0) {
                return interaction.reply({ content: '📂 현재 `audio` 폴더에 mp3 파일이 없습니다.', ephemeral: true });
            }
            interaction.reply({ content: `🎵 **사용 가능한 오디오 목록:**\n${mp3Files.map(f => `- \`${f}\``).join('\n')}`, ephemeral: true });
        });
        return;
    }

    // '/중지'
    if (commandName === '중지') {
        const timerData = activeTimers.get(interaction.user.id);
        if (!timerData) {
            return interaction.reply({ content: '❌ 현재 진행 중인 뽀모도로 타이머가 없습니다.', ephemeral: true });
        }

        timerData.timeouts.forEach(clearTimeout);
        if (timerData.player) timerData.player.stop();
        if (timerData.connection) timerData.connection.destroy();

        activeTimers.delete(interaction.user.id);
        return interaction.reply('🛑 뽀모도로 타이머를 중지했습니다.');
    }

    // '/배경음'
    if (commandName === '배경음') {
        let bgmName = interaction.options.getString('파일명');
        if (bgmName === '없음' || bgmName === '무음') bgmName = null;
        else if (!bgmName.endsWith('.mp3')) bgmName += '.mp3';

        const userSettings = userAudioSettings.get(interaction.user.id) || { bgmName: null, notifyName: 'notify.mp3' };
        userSettings.bgmName = bgmName;
        userAudioSettings.set(interaction.user.id, userSettings);

        return interaction.reply(`🎵 배경음이 **${bgmName ? bgmName : '없음(무음)'}**(으)로 설정되었습니다!`);
    }

    // '/알림음'
    if (commandName === '알림음') {
        let notifyName = interaction.options.getString('파일명');
        if (!notifyName.endsWith('.mp3')) notifyName += '.mp3';

        const userSettings = userAudioSettings.get(interaction.user.id) || { bgmName: null, notifyName: 'notify.mp3' };
        userSettings.notifyName = notifyName;
        userAudioSettings.set(interaction.user.id, userSettings);

        return interaction.reply(`🔔 알림음이 **${notifyName}**(으)로 설정되었습니다!`);
    }

    // '/시작'
    if (commandName === '시작') {
        if (activeTimers.has(interaction.user.id)) {
            return interaction.reply({ content: '⏳ 현재 뽀모도로 타이머가 이미 진행 중입니다! (중지하려면 `/중지`를 입력하세요)', ephemeral: true });
        }

        const voiceChannel = interaction.member?.voice?.channel;

        if (!voiceChannel) {
            return interaction.reply({ content: '❌ 봇이 알림음을 재생하려면 먼저 음성 채널에 접속해 있어야 합니다.', ephemeral: true });
        }

        const workMins = interaction.options.getInteger('집중시간') || 25;
        const breakMins = interaction.options.getInteger('휴식시간') || 5;

        // 사용자의 오디오 설정 불러오기
        const userSettings = userAudioSettings.get(interaction.user.id) || { bgmName: null, notifyName: 'notify.mp3' };
        let bgmName = userSettings.bgmName || null;
        let notifyName = userSettings.notifyName || 'notify.mp3';

        const workTimeMs = workMins * 60 * 1000;
        const breakTimeMs = breakMins * 60 * 1000;

        const workEndTime = Math.floor((Date.now() + workTimeMs) / 1000);
        let settingMsg = `⚙️ **설정**: 집중 ${workMins}분 / 휴식 ${breakMins}분`;
        if (bgmName) settingMsg += ` / 배경음: ${bgmName}`;
        settingMsg += ` / 알림음: ${notifyName}`;

        await interaction.reply(`🍅 **뽀모도로 타이머 시작!** 딴짓 금지, 집중해 보세요! (종료: <t:${workEndTime}:R>)\n${settingMsg}`);

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: interaction.guild.id,
            adapterCreator: interaction.guild.voiceAdapterCreator,
        });

        const player = createAudioPlayer();
        connection.subscribe(player);

        const timerData = {
            timeouts: [],
            connection,
            player,
            channel: interaction.channel
        };
        activeTimers.set(interaction.user.id, timerData);

        let isFocusTime = true;

        if (bgmName) {
            const bgmPath = path.join(AUDIO_DIR, bgmName);
            if (fs.existsSync(bgmPath)) {
                player.play(createAudioResource(bgmPath));

                player.on(AudioPlayerStatus.Idle, () => {
                    // 집중 시간일 때만 BGM 무한 반복 재생
                    if (isFocusTime && bgmName && fs.existsSync(bgmPath)) {
                        player.play(createAudioResource(bgmPath));
                    }
                });
            } else {
                interaction.channel.send(`⚠️ (경고) \`${bgmName}\` 파일을 찾을 수 없어 배경 음악 없이 진행합니다.`);
                bgmName = null;
            }
        }

        const notifyPath = path.join(AUDIO_DIR, notifyName);

        const workTimeout = setTimeout(() => {
            isFocusTime = false;
            player.stop(); // 루프 중단 (혹은 마지막 1회 재생도 즉시 종료시킴)

            const breakEndTime = Math.floor((Date.now() + breakTimeMs) / 1000);
            interaction.channel.send(`🔔 <@${interaction.user.id}>님, 집중 시간이 지났습니다! 고생하셨어요.\n지금부터 **푹 쉬고 오세요!** ☕ (휴식 종료: <t:${breakEndTime}:R>)`);

            if (fs.existsSync(notifyPath)) {
                player.play(createAudioResource(notifyPath));
            } else {
                interaction.channel.send(`⚠️ (경고) \`${notifyName}\` 파일을 찾을 수 없습니다.`);
            }

            const breakTimeout = setTimeout(() => {
                interaction.channel.send(`⏰ <@${interaction.user.id}>님, 휴식 시간이 끝났습니다!\n다시 집중할 시간입니다. (다시 시작하려면 \`/시작\`을 입력하세요)`);

                if (fs.existsSync(notifyPath)) {
                    player.play(createAudioResource(notifyPath));
                }

                const endTimeout = setTimeout(() => {
                    connection.destroy();
                    activeTimers.delete(interaction.user.id);
                }, 60000);
                timerData.timeouts.push(endTimeout);

            }, breakTimeMs);
            timerData.timeouts.push(breakTimeout);

        }, workTimeMs);
        timerData.timeouts.push(workTimeout);
    }
});

client.login(process.env.DISCORD_TOKEN);