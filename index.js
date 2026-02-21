require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const path = require('path');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// 현재 타이머가 진행 중인 유저를 추적하기 위한 Map
// key: userId, value: { timeouts: [], player: AudioPlayer, connection: VoiceConnection }
const activeTimers = new Map();

// 유저별 오디오 설정 저장 Map
// key: userId, value: { bgmName: string | null, notifyName: string }
const userAudioSettings = new Map();

const AUDIO_DIR = path.join(__dirname, 'audio');
if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR);
}

client.on('ready', () => {
    console.log(`✅ ${client.user.tag} 봇이 성공적으로 로그인했습니다!`);
});

client.on('messageCreate', (message) => {
    if (message.author.bot) return;

    // '!뽀모도로 도움말'
    if (message.content === '!뽀모도로 도움말') {
        return message.reply(`🍅 **뽀모도로 봇 사용법 안내** 🍅

🔹 \`!뽀모도로 시작 [집중시간] [휴식시간]\`
타이머를 시작합니다. 시간은 분 단위로 입력합니다.
예시: \`!뽀모도로 시작 30 10\`
(값을 생략하면 기본값인 **집중 25분 / 휴식 5분**으로 실행됩니다.)

🔹 \`!뽀모도로 배경음 [파일명]\`
집중 시간 동안 재생될 배경 음악을 설정합니다. (무음 설정: \`!뽀모도로 배경음 없음\`)
    
🔹 \`!뽀모도로 알림음 [파일명]\`
타이머 종료 시 재생될 알림음을 설정합니다. (기본값: \`notify.mp3\`)

🔹 \`!뽀모도로 오디오 목록\`
자유롭게 사용할 수 있는 오디오 파일(.mp3) 목록을 확인합니다.

🔹 \`!뽀모도로 중지\`
진행 중인 타이머를 즉시 중지하고 봇을 내보냅니다.

🔹 \`!뽀모도로 도움말\`
지금 보고 계신 안내 메시지를 출력합니다.`);
    }

    // '!뽀모도로 목록'
    if (message.content === '!뽀모도로 오디오 목록') {
        fs.readdir(AUDIO_DIR, (err, files) => {
            if (err) {
                console.error(err);
                return message.reply('❌ 오디오 목록을 불러오는데 실패했습니다.');
            }
            const mp3Files = files.filter(f => f.endsWith('.mp3'));
            if (mp3Files.length === 0) {
                return message.reply('📂 현재 `audio` 폴더에 mp3 파일이 없습니다.');
            }
            message.reply(`🎵 **사용 가능한 오디오 목록:**\n${mp3Files.map(f => `- \`${f}\``).join('\n')}`);
        });
        return;
    }

    // '!뽀모도로 중지'
    if (message.content === '!뽀모도로 중지') {
        const timerData = activeTimers.get(message.author.id);
        if (!timerData) {
            return message.reply('❌ 현재 진행 중인 뽀모도로 타이머가 없습니다.');
        }

        timerData.timeouts.forEach(clearTimeout);
        if (timerData.player) timerData.player.stop();
        if (timerData.connection) timerData.connection.destroy();

        activeTimers.delete(message.author.id);
        return message.reply('🛑 뽀모도로 타이머를 중지했습니다.');
    }

    // '!뽀모도로 배경음'
    if (message.content.startsWith('!뽀모도로 배경음')) {
        const args = message.content.split(/\s+/).slice(2);
        if (args.length === 0) return message.reply('❌ 설정할 배경음 파일명을 입력해주세요. (예: `!뽀모도로 배경음 bgm.mp3` 또는 `!뽀모도로 배경음 없음`)');
        let bgmName = args[0];
        if (bgmName === '없음' || bgmName === '무음') bgmName = null;
        else if (!bgmName.endsWith('.mp3')) bgmName += '.mp3';

        const userSettings = userAudioSettings.get(message.author.id) || { bgmName: null, notifyName: 'notify.mp3' };
        userSettings.bgmName = bgmName;
        userAudioSettings.set(message.author.id, userSettings);

        return message.reply(`🎵 배경음이 **${bgmName ? bgmName : '없음(무음)'}**(으)로 설정되었습니다!`);
    }

    // '!뽀모도로 알림음'
    if (message.content.startsWith('!뽀모도로 알림음')) {
        const args = message.content.split(/\s+/).slice(2);
        if (args.length === 0) return message.reply('❌ 설정할 알림음 파일명을 입력해주세요. (예: `!뽀모도로 알림음 bell.mp3`)');
        let notifyName = args[0];
        if (!notifyName.endsWith('.mp3')) notifyName += '.mp3';

        const userSettings = userAudioSettings.get(message.author.id) || { bgmName: null, notifyName: 'notify.mp3' };
        userSettings.notifyName = notifyName;
        userAudioSettings.set(message.author.id, userSettings);

        return message.reply(`🔔 알림음이 **${notifyName}**(으)로 설정되었습니다!`);
    }

    // '!뽀모도로 시작'
    if (message.content.startsWith('!뽀모도로 시작')) {
        if (activeTimers.has(message.author.id)) {
            return message.reply('⏳ 현재 뽀모도로 타이머가 이미 진행 중입니다! (중지하려면 `!뽀모도로 중지`를 입력하세요)');
        }

        // 띄어쓰기 기준으로 파라미터 파싱
        const args = message.content.split(/\s+/).slice(2);

        // 시간 기본값 설정
        let workMins = 25;
        let breakMins = 5;

        if (args.length >= 1 && !isNaN(args[0])) workMins = parseFloat(args[0]);
        if (args.length >= 2 && !isNaN(args[1])) breakMins = parseFloat(args[1]);

        // 사용자의 오디오 설정 불러오기
        const userSettings = userAudioSettings.get(message.author.id) || { bgmName: null, notifyName: 'notify.mp3' };
        let bgmName = userSettings.bgmName || null;
        let notifyName = userSettings.notifyName || 'notify.mp3';

        const workTimeMs = workMins * 60 * 1000;
        const breakTimeMs = breakMins * 60 * 1000;

        const voiceChannel = message.member?.voice.channel;

        if (!voiceChannel) {
            return message.reply('❌ 봇이 알림음을 재생하려면 먼저 음성 채널에 접속해 있어야 합니다.');
        }

        const workEndTime = Math.floor((Date.now() + workTimeMs) / 1000);
        let settingMsg = `⚙️ **설정**: 집중 ${workMins}분 / 휴식 ${breakMins}분`;
        if (bgmName) settingMsg += ` / 배경음: ${bgmName}`;
        settingMsg += ` / 알림음: ${notifyName}`;

        message.reply(`🍅 **뽀모도로 타이머 시작!** 딴짓 금지, 집중해 보세요! (종료: <t:${workEndTime}:R>)\n${settingMsg}`);

        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });

        const player = createAudioPlayer();
        connection.subscribe(player);

        const timerData = {
            timeouts: [],
            connection,
            player
        };
        activeTimers.set(message.author.id, timerData);

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
                message.channel.send(`⚠️ (경고) \`${bgmName}\` 파일을 찾을 수 없어 배경 음악 없이 진행합니다.`);
                bgmName = null;
            }
        }

        const notifyPath = path.join(AUDIO_DIR, notifyName);

        const workTimeout = setTimeout(() => {
            isFocusTime = false;
            player.stop(); // 루프 중단 (혹은 마지막 1회 재생도 즉시 종료시킴)

            const breakEndTime = Math.floor((Date.now() + breakTimeMs) / 1000);
            message.channel.send(`🔔 <@${message.author.id}>님, 집중 시간이 지났습니다! 고생하셨어요.\n지금부터 **푹 쉬고 오세요!** ☕ (휴식 종료: <t:${breakEndTime}:R>)`);

            if (fs.existsSync(notifyPath)) {
                player.play(createAudioResource(notifyPath));
            } else {
                message.channel.send(`⚠️ (경고) \`${notifyName}\` 파일을 찾을 수 없습니다.`);
            }

            const breakTimeout = setTimeout(() => {
                message.channel.send(`⏰ <@${message.author.id}>님, 휴식 시간이 끝났습니다!\n다시 집중할 시간입니다. (다시 시작하려면 \`!뽀모도로 시작\`을 입력하세요)`);

                if (fs.existsSync(notifyPath)) {
                    player.play(createAudioResource(notifyPath));
                }

                const endTimeout = setTimeout(() => {
                    connection.destroy();
                    activeTimers.delete(message.author.id);
                }, 60000);
                timerData.timeouts.push(endTimeout);

            }, breakTimeMs);
            timerData.timeouts.push(breakTimeout);

        }, workTimeMs);
        timerData.timeouts.push(workTimeout);
    }
});

client.login(process.env.DISCORD_TOKEN);