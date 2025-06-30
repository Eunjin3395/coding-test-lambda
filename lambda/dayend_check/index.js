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
const USERNAMES = ["eunjin3395", "rimi_lim", "kslvy", "j11gen"];
const USER_MAP = {
  eunjin3395: "은진",
  kslvy: "경은",
  j11gen: "성윤",
  parksanghoon4817: "상훈",
  "3veryDay": "현서",
};
const STATUS_MAP = {
  present: "출석 🟢",
  wildcard_present: "출석* 🟢",
  late: "지각 🟠",
  wildcard_late: "지각* 🟠",
  ongoing: "진행 🟡",
  wildcard_ongoing: "진행* 🟡",
  dayoff: "휴무 :white_circle:",
  absent: "결석 🔴",
};

// join time 추출 util
const timeOnly = (str) => {
  if (!str || str === "-") return "-";
  return str.split(" ")[1] || "-";
};

const handler = async () => {
  const now = dayjs().tz("Asia/Seoul");
  const targetDate = now.subtract(1, "day").format("YYYY-MM-DD");
  const deadline1 = dayjs.tz(`${targetDate} 07:11:00`, "Asia/Seoul");

  const resultSummary = [];
  for (const username of USERNAMES) {
    const { Item } = await dynamo
      .get({
        TableName: ATTENDANCE_TABLE,
        Key: { date: targetDate, username },
      })
      .promise();

    if (!Item) continue;

    const { joinedAt, pr = [], attendance } = Item;
    let newStatus = attendance;
    const hasJoined = !!joinedAt;

    // 🎯 상태 재판정 조건 분기
    if (["ongoing", "wildcard_ongoing", "wildcard_late", "late"].includes(attendance)) {
      const prLen = pr.length;

      if (attendance === "wildcard_ongoing") {
        newStatus = prLen >= 1 ? "wildcard_present" : "absent";
      } else if (attendance === "wildcard_late") {
        newStatus = prLen >= 1 ? "wildcard_late" : "absent";
      } else if (attendance === "late") {
        newStatus = prLen >= 2 ? "late" : "absent";
      } else if (attendance === "ongoing") {
        newStatus = prLen >= 2 ? "present" : "absent";
      }

      // 업데이트
      await dynamo
        .update({
          TableName: ATTENDANCE_TABLE,
          Key: { date: targetDate, username },
          UpdateExpression: "SET attendance = :status",
          ExpressionAttributeValues: { ":status": newStatus },
        })
        .promise();
    }

    resultSummary.push({
      username,
      attendance: STATUS_MAP[newStatus],
      joinedAt: newStatus === "dayoff" ? "-" : joinedAt || "-",
      prCount: newStatus === "dayoff" ? "-" : pr.length,
    });
  }

  // 이전 Discord 메시지 ID 조회
  const history = await dynamo
    .get({
      TableName: MESSAGE_HISTORY_TABLE,
      Key: { date: targetDate },
    })
    .promise();

  const messageId = history.Item?.messageId;
  if (!messageId) {
    console.error("❌ Discord 메시지 ID 없음: 수정 불가");
    return { statusCode: 500, body: "No Discord message ID found." };
  }

  // 수정할 메시지 내용 구성
  let newMessage = `## 🗓️ ${targetDate}\n`;
  for (const r of resultSummary) {
    newMessage += `- **${USER_MAP[r.username]}**: ${r.attendance} | 제출: ${r.prCount} | *${timeOnly(r.joinedAt)}*\n`;
  }
  newMessage += `*updated at ${now.format("HH:mm:ss")}*`;

  // 메시지 PATCH (Discord 수정 API 사용)
  try {
    await axios.patch(`${DISCORD_WEBHOOK}/messages/${messageId}`, { content: newMessage }, { headers: { "Content-Type": "application/json" } });

    console.log("✅ Discord 메시지 수정 완료");
  } catch (err) {
    console.error("❌ Discord 메시지 수정 실패:", err.message);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "출석 재집계 및 메시지 수정 완료",
      result: resultSummary,
    }),
  };
};

module.exports = { handler };
