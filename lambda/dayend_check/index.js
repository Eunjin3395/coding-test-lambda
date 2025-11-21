const AWS = require("aws-sdk");
const axios = require("axios");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
require("dotenv").config();

dayjs.extend(utc);
dayjs.extend(timezone);

const dynamo = new AWS.DynamoDB.DocumentClient({});

const ATTENDANCE_TABLE = "Attendance";
const MESSAGE_HISTORY_TABLE = "AttendanceMessageHistory";

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const USERNAMES = ["haru_95532", "chong2422", "gimhojun0668", "j11gen", "gimyeongman0658", "invite_me_41", "incredible_dragon_84712"];
const USER_MAP = {
  // eunjin3395: "은진",
  haru_95532: "현서",
  chong2422: "총명",
  gimhojun0668: "호준",
  j11gen: "성윤",
  gimyeongman0658: "영만",
  invite_me_41: "문형",
  incredible_dragon_84712: "제희",
};

const STATUS_MAP = {
  present: "출석 🟢",
  late: "지각 🟠",
  ongoing: "진행 🟡",
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

    // 🎯 상태 재판정 조건 분기
    if (["ongoing", "late"].includes(attendance)) {
      const prLen = pr.length;

      if (attendance === "late") {
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
  const dt_messageId = messageId[0];
  const nt_messageId = messageId[1];

  // 수정할 메시지 내용 구성
  let newMessage = `## 🗓️ ${targetDate}\n`;
  for (const r of resultSummary) {
    newMessage += `- **${USER_MAP[r.username]}**: ${r.attendance} | 제출: ${r.prCount} | *${timeOnly(r.joinedAt)}*\n`;
  }
  newMessage += `*updated at ${now.format("HH:mm:ss")}*`;

  // dt 메시지 삭제
  try {
    await axios.delete(`${DISCORD_WEBHOOK}/messages/${dt_messageId}`);

    console.log(`🗑️ Discord 메시지 삭제 완료 (dt_messageId: ${dt_messageId})`);
  } catch (err) {
    console.error("❌ Discord 메시지 삭제 실패:", err.message);
  }

  // 메시지 PATCH (Discord 수정 API 사용)
  try {
    await axios.patch(`${DISCORD_WEBHOOK}/messages/${nt_messageId}`, { content: newMessage }, { headers: { "Content-Type": "application/json" } });

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
