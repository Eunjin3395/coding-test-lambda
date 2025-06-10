const AWS = require("aws-sdk");
const dayjs = require("dayjs");
const axios = require("axios");
require("dayjs/locale/ko");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
require("dotenv").config();

dayjs.extend(utc);
dayjs.extend(timezone);

const TABLE_NAME = "VoiceChannelMembers";
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

const USER_MAP = {
  eunjin3395: "은진",
  rimi_lim: "효림",
  kslvy: "경은",
  j11gen: "성윤",
};

// ✅ KST 기준 날짜 문자열 반환
const getTodayKSTDate = () => dayjs().tz("Asia/Seoul").format("YYYY-MM-DD");
const getNowKSTDateTime = () => dayjs().tz("Asia/Seoul").format("YYYY-MM-DD HH:mm:ss");

// ✅ username → 이름 변환
const displayName = (username) => USER_MAP[username] || username;

const dynamo = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

// ✅ 디스코드 메시지 전송
const sendDiscord = async (joinedUsers, notJoinedUsers, now) => {
  try {
    const joinedMsg = joinedUsers.length
      ? "### ✅ 출석\n" +
        joinedUsers
          .map(displayName)
          .map((u) => `- ${u}`)
          .join("\n")
      : "";

    const notJoinedMsg = notJoinedUsers.length
      ? "### ⏰ 지각\n" +
        notJoinedUsers
          .map(displayName)
          .map((u) => `- ${u}`)
          .join("\n")
      : "";

    const message = [`## ☑️ ${getTodayKSTDate()} 출석 체크\n`, joinedMsg, "", notJoinedMsg, `\n*${now}*`].join("\n");

    const response = await axios.post(`${DISCORD_WEBHOOK}?wait=true`, { content: message });

    const messageId = response.data.id; // 메시지 ID
    console.log(`✅ Discord 메시지 전송 완료 (messageId: ${messageId})`);

    return messageId;
  } catch (error) {
    console.error("❌ Discord 메시지 전송 오류:", error);
    return null;
  }
};

const saveAttendanceMessage = async ({ messageId, joinedUsers, lateUsers, sentAt }) => {
  const date = dayjs(sentAt).tz("Asia/Seoul").format("YYYY-MM-DD");

  const item = {
    date, // 파티션 키
    messageId, // 정렬 키
    sentAt,
    attendance: {
      joined: joinedUsers,
      late: lateUsers,
    },
  };

  await dynamo
    .put({
      TableName: "AttendanceMessageHistory",
      Item: item,
    })
    .promise();

  console.log(`✅ 출석 기록 저장 완료 (${date}, ${messageId})`);
};

// ✅ 메인 Lambda 함수
const handler = async () => {
  try {
    const now = getNowKSTDateTime();

    const params = {
      TableName: TABLE_NAME,
      KeyConditionExpression: "channelId = :channelId",
      ExpressionAttributeValues: {
        ":channelId": TARGET_CHANNEL_ID,
      },
    };

    const result = await dynamo.query(params).promise();
    const joinedUsers = result.Items.map((item) => item.username);
    const allUsers = Object.keys(USER_MAP);
    const lateUsers = allUsers.filter((uname) => !joinedUsers.includes(uname));

    console.log(`📅 ${now} 기준 음성 채널 상태`);
    console.log("✅ 접속 중:");
    joinedUsers.forEach((u) => console.log(`- ${displayName(u)}`));
    console.log("\n❌ 미접속:");
    lateUsers.forEach((u) => console.log(`- ${displayName(u)}`));

    const messageId = await sendDiscord(joinedUsers, lateUsers, now);

    await saveAttendanceMessage({
      messageId,
      joinedUsers,
      lateUsers,
      sentAt: now,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        timestamp: now,
        joined: joinedUsers.map(displayName),
        notJoined: lateUsers.map(displayName),
      }),
    };
  } catch (err) {
    console.error("❌ Lambda 실행 오류:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

module.exports = { handler };
