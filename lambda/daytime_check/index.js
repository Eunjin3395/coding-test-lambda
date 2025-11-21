const AWS = require("aws-sdk");
const axios = require("axios");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
require("dotenv").config();
dayjs.extend(utc);
dayjs.extend(timezone);

const dynamo = new AWS.DynamoDB.DocumentClient({
  region: "ap-northeast-2",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const ATTENDANCE_TABLE = "Attendance";
const MESSAGE_HISTORY_TABLE = "AttendanceMessageHistory";
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

const USERNAMES = ["haru_95532", "chong2422", "gimhojun0668"];
const USER_MAP = {
  haru_95532: "현서",
  chong2422: "총명",
  gimhojun0668: "호준",
};

const STATUS_MAP = {
  present: "출석 🟢",
  late: "지각 🟠",
  ongoing: "진행 🟡",
  dayoff: "휴무 :white_circle:",
  absent: "결석 🔴",
};

// 디스코드 메시지 전송
const sendDiscordMessage = async (content) => {
  try {
    const response = await axios.post(
      `${DISCORD_WEBHOOK}?wait=true`,
      { content },
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    const messageId = response.data.id; // 메시지 ID
    console.log(`✅ Discord 메시지 전송 완료 (messageId: ${messageId})`);

    return messageId;
  } catch (err) {
    console.error("❌ Discord 메시지 전송 실패:", err.message);
    throw err;
  }
};

const timeOnly = (str) => {
  if (!str || str === "-") return "-";
  return str.split(" ")[1] || "-";
};

const handler = async () => {
  const now = dayjs().tz("Asia/Seoul");
  const today = now.format("YYYY-MM-DD");
  const deadline1 = dayjs.tz(`${today} 07:01:00`, "Asia/Seoul");
  const deadline2 = dayjs.tz(`${today} 07:31:00`, "Asia/Seoul");
  const resultSummary = [];

  for (const username of USERNAMES) {
    const { Item } = await dynamo
      .get({
        TableName: ATTENDANCE_TABLE,
        Key: { date: today, username },
      })
      .promise();

    if (!Item) continue;

    const { joinedAt, pr = [], attendance } = Item;

    let newStatus = attendance;

    // 출석 상태 업데이트, 휴무인 경우 대상에서 제외
    if (attendance !== "dayoff") {
      const hasJoined = !!joinedAt;

      // 일반 출석
      if (!hasJoined) {
        newStatus = "absent"; // 입장 안한 경우
      } else if (dayjs.tz(joinedAt, "Asia/Seoul").isAfter(deadline2)) {
        newStatus = "absent"; // 입장 시각 결석인 경우
      } else if (dayjs.tz(joinedAt, "Asia/Seoul").isAfter(deadline1)) {
        newStatus = "late"; // 입장 시각 지각인 경우
      } else if (pr.length >= 2) {
        newStatus = "present"; // 문제 2개 이상 제출한 경우
      } else {
        newStatus = "ongoing";
      }

      await dynamo
        .update({
          TableName: ATTENDANCE_TABLE,
          Key: { date: today, username },
          UpdateExpression: "SET attendance = :status",
          ExpressionAttributeValues: { ":status": newStatus },
        })
        .promise();
    }

    resultSummary.push({
      username,
      joinedAt: newStatus === "dayoff" ? "-" : joinedAt || "-",
      prCount: newStatus === "dayoff" ? "-" : pr.length,
      attendance: STATUS_MAP[newStatus],
    });
  }

  // Discord 메시지 작성
  let message = `## ☀️ ${today}\n`;
  for (const r of resultSummary) {
    const joinedTime = timeOnly(r.joinedAt);
    message += `- **${USER_MAP[r.username]}**: ${r.attendance} | 제출: ${r.prCount} | *${joinedTime}*\n`;
  }

  message += `*checked at ${now.format("HH:mm:ss")}*`;

  // 메시지 전송 및 메시지 ID 저장
  const messageId = await sendDiscordMessage(message);

  await dynamo
    .put({
      TableName: MESSAGE_HISTORY_TABLE,
      Item: {
        date: today,
        messageId: [messageId],
        sentAt: [now.toISOString()],
      },
    })
    .promise();

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "출석 판정 및 메시지 전송 완료",
      result: resultSummary,
    }),
  };
};

module.exports = { handler };
