const { Client, GatewayIntentBits } = require('discord.js');

// 봇 클라이언트 생성 (메시지 읽기 권한 추가)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 시간 설정 (밀리초 단위)
// 테스트할 때는 25 * 60 * 1000 대신 5000(5초) 등으로 줄여서 확인해 보세요!
const WORK_TIME = 25 * 60 * 1000; // 25분
const BREAK_TIME = 5 * 60 * 1000; // 5분

client.on('ready', () => {
    console.log(`✅ ${client.user.tag} 봇이 성공적으로 로그인했습니다!`);
});

client.on('messageCreate', (message) => {
    // 봇이 보낸 메시지는 무시
    if (message.author.bot) return;

    // '!뽀모도로 시작' 명령어 인식
    if (message.content === '!뽀모도로 시작') {
        message.reply('🍅 **뽀모도로 타이머 시작!** 지금부터 25분 동안 딴짓 금지, 집중해 보세요!');

        // 25분(WORK_TIME) 후 휴식 알림
        setTimeout(() => {
            message.channel.send(`🔔 <@${message.author.id}>님, 25분이 지났습니다! 고생하셨어요.\n지금부터 **5분 동안 푹 쉬고 오세요!** ☕`);

            // 5분(BREAK_TIME) 후 휴식 종료 알림
            setTimeout(() => {
                message.channel.send(`⏰ <@${message.author.id}>님, 휴식 시간이 끝났습니다!\n다시 집중할 시간입니다. (다시 시작하려면 \`!뽀모도로 시작\`을 입력하세요)`);
            }, BREAK_TIME);

        }, WORK_TIME);
    }
});

// 발급받은 봇 토큰을 아래에 입력하세요
client.login(process.env.BOT_TOKEN);