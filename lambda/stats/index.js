const axios = require("axios");
const dayjs = require("dayjs");
require("dotenv").config();

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_PAGE_URL = "https://api.notion.com/v1/databases";
const MEMBERS = ["은진", "효림", "성윤", "경은"];

// KST 기준 오늘 날짜 (YYYY-MM-DD)
const getTodayKST_ISO = () => dayjs().add(9, "hour").format("YYYY-MM-DD");

/**
 * 주어진 날짜가 속한 주의 월~금 사이 문제를 조회
 * @param {string} targetDate - YYYY-MM-DD 형식
 * @returns {Promise<Array>} - 해당 주차의 문제 리스트
 */
const getWeekdayProblemsFromNotion = async (targetDate) => {
  const base = dayjs(targetDate);
  const startOfWeek = base.startOf("week").add(1, "day").format("YYYY-MM-DD"); // 월요일
  const endOfFriday = base.startOf("week").add(5, "day").format("YYYY-MM-DD"); // 금요일

  try {
    const response = await axios.post(
      `${NOTION_PAGE_URL}/${NOTION_DATABASE_ID}/query`,
      {
        filter: {
          and: [
            {
              property: "날짜",
              date: {
                on_or_after: startOfWeek,
              },
            },
            {
              property: "날짜",
              date: {
                on_or_before: endOfFriday,
              },
            },
          ],
        },
        sorts: [
          {
            property: "날짜",
            direction: "ascending",
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Content-Type": "application/json",
          "Notion-Version": "2022-06-28",
        },
      }
    );

    const pages = response.data.results;
    console.log(`📄 ${startOfWeek} ~ ${endOfFriday} 기간 조회된 문제 수: ${pages.length}`);
    return pages;
  } catch (error) {
    console.error("❌ Notion 조회 실패:", error.response?.data || error.message);
    return [];
  }
};

/**
 * 스터디원별 제출/성공 개수 및 성공률 계산
 *
 * @param {Array} problems - Notion에서 조회한 문제 리스트
 * @returns {Object} - 각 스터디원별 { submitted, solved, rate }
 */
function getMemberStats(problems) {
  const result = {};

  for (const member of MEMBERS) {
    let submitted = 0;
    let solved = 0;

    for (const problem of problems) {
      const isSubmitted = problem.properties[`제출${member}`]?.checkbox ?? false;
      const isSolved = problem.properties[member]?.checkbox ?? false;

      if (isSubmitted) {
        submitted++;
        if (isSolved) solved++;
      }
    }

    result[member] = {
      submitted,
      solved,
      rate: submitted > 0 ? +((solved / submitted) * 100).toFixed(1) : 0,
    };
  }

  return result;
}

/**
 * 스터디원 기준 문제 유형별 성공률 계산
 * @param {Array} problems - 조회된 Notion 문제 리스트
 * @param {string} memberName - 스터디원 이름 (e.g., "성윤")
 * @returns {Object} { 유형명: { success: n, total: m, rate: x } }
 */
function calculateMemberSuccessRateByType(problems, memberName) {
  const result = {};

  for (const problem of problems) {
    const types = problem.properties["유형"].multi_select.map((t) => t.name);
    const isSubmitted = problem.properties[`제출${memberName}`]?.checkbox ?? false;
    const isSolved = problem.properties[memberName]?.checkbox ?? false;

    if (!isSubmitted) continue; // 제출 안 한 문제는 제외

    for (const type of types) {
      if (!result[type]) result[type] = { success: 0, total: 0 };
      result[type].total += 1;
      if (isSolved) result[type].success += 1;
    }
  }

  // 성공률 계산
  for (const type in result) {
    const { success, total } = result[type];
    result[type].rate = total > 0 ? +((success / total) * 100).toFixed(1) : 0;
  }

  return result;
}

/**
 * 전체 스터디원의 문제 유형별 성공률 계산
 * @param {Array} problems - 조회된 문제들
 * @returns {Object} { 유형명: { success: n, total: m, rate: x } }
 */
function calculateOverallSuccessRateByType(problems) {
  const result = {};

  for (const problem of problems) {
    const types = problem.properties["유형"].multi_select.map((t) => t.name);

    for (const member of MEMBERS) {
      const isSubmitted = problem.properties[`제출${member}`]?.checkbox ?? false;
      const isSolved = problem.properties[member]?.checkbox ?? false;

      if (!isSubmitted) continue;

      for (const type of types) {
        if (!result[type]) result[type] = { success: 0, total: 0 };
        result[type].total += 1;
        if (isSolved) result[type].success += 1;
      }
    }
  }

  for (const type in result) {
    const { success, total } = result[type];
    result[type].rate = total > 0 ? +((success / total) * 100).toFixed(1) : 0;
  }

  return result;
}

/**
 * 문제 유형 통계에서 total >= n인 항목 중
 * rate가 낮은 순서로 하위 k위까지 포함되는 모든 유형 반환 (동률 포함)
 * 단, 최하위 성공률이 100%이면 빈 배열 반환
 *
 * @param {Object} stats - 문제 유형별 { success, total, rate } 구조 객체
 * @param {number} n - 최소 total 제출 수
 * @param {number} k - 하위 k위까지 포함할 기준
 * @returns {Array<string>} - 하위 k위의 모든 유형 이름
 */
function getLowestSuccessRateTypes(stats, n, k) {
  // 1. total ≥ n인 항목만 추출
  const filtered = Object.entries(stats).filter(([_, data]) => data.total >= n);
  if (filtered.length === 0) return [];

  // 2. 성공률 기준 오름차순 정렬
  const sorted = filtered.sort((a, b) => a[1].rate - b[1].rate);

  // 3. 최하위 성공률 확인
  const minRate = sorted[0][1].rate;
  if (minRate === 100) return [];

  // 4. 하위 k위까지 포함할 최소 성공률 기준 계산
  const rateThresholds = [...new Set(sorted.map(([_, data]) => data.rate))]; // 고유 rate 정렬
  const limitRate = rateThresholds[k - 1] ?? rateThresholds.at(-1); // k위에 해당하는 rate

  // 5. 해당 rate 이하인 모든 유형 추출
  return sorted.filter(([_, data]) => data.rate <= limitRate).map(([type]) => type);
}

/**
 * memberStats 기반 멤버별 F1 점수 계산
 * @param {Object} stats
 * @returns
 */
function calculateF1Scores(stats) {
  const maxSolved = Math.max(...Object.values(stats).map((s) => s.solved));

  const result = {};
  for (const [name, { submitted, solved }] of Object.entries(stats)) {
    const precision = submitted > 0 ? solved / submitted : 0;
    const recall = maxSolved > 0 ? solved / maxSolved : 0;
    const f1 = precision + recall > 0 ? +((2 * precision * recall) / (precision + recall)).toFixed(4) : 0;

    result[name] = {
      precision: +precision.toFixed(4),
      recall: +recall.toFixed(4),
      f1,
    };
  }

  return result;
}

/**
 * F1 점수를 기준으로 MVP 스터디원을 추출
 * 동률이면 모두 반환
 *
 * @param {Object} f1Stats - 스터디원별 { precision, recall, f1 } 객체
 * @returns {Array<string>} - MVP 스터디원 이름 배열
 */
function getMVPByF1(f1Stats) {
  const maxF1 = Math.max(...Object.values(f1Stats).map((v) => v.f1));
  return Object.entries(f1Stats)
    .filter(([_, v]) => v.f1 === maxF1)
    .map(([name]) => name);
}

// 디스코드 메시지 전송
const sendDiscord = async ({ problems, memberStats, lowestTypes, mvps }) => {
  try {
    const startOfWeek = dayjs().startOf("week").add(1, "day").format("YYYY-MM-DD");
    const endOfWeek = dayjs().startOf("week").add(5, "day").format("YYYY-MM-DD");

    let message = `## 📊 주간 스터디 리포트\n`;
    message += `📅 기간: ${startOfWeek} ~ ${endOfWeek}\n\n`;

    message += `### 👥 멤버별 통계 (스스로 해결 / 제출)\n`;
    for (const member of MEMBERS) {
      const { submitted, solved, rate } = memberStats[member];
      message += `> ${member}: ${solved}건 / ${submitted}건 (${rate}%)\n`;
    }

    message += `\n### 📉 공통 취약 유형 TOP 3\n`;
    lowestTypes.forEach((type) => {
      message += `• ${type}\n`;
    });

    message += `\n### 🧩 멤버별 가장 어려워한 유형\n`;
    for (const member of MEMBERS) {
      const memberRate = calculateMemberSuccessRateByType(problems, member);
      const memberWeakTypes = getLowestSuccessRateTypes(memberRate, 1, 1);
      message += `> ${member}: ${memberWeakTypes.length ? memberWeakTypes.join(", ") : "-"}\n`;
    }

    message += `\n### 🏆 이번 주 MVP: ${mvps.join(", ")} 🏆`;

    await axios.post(DISCORD_WEBHOOK, { content: message });
    console.log("✅ Discord message sent");
  } catch (error) {
    console.error("❌ Error sending discord message:", error);
  }
};

async function analyzeWeeklyStudy(problems) {
  const memberStats = getMemberStats(problems);
  console.table(memberStats);

  const overallSuccessRate = calculateOverallSuccessRateByType(problems);
  const lowestTypes = getLowestSuccessRateTypes(overallSuccessRate, 3, 3);
  console.log("2. 성공률 낮은 유형 TOP 3:", lowestTypes);

  console.log("3. 멤버별 취약 유형");
  for (const member of MEMBERS) {
    const memberSuccessRate = calculateMemberSuccessRateByType(problems, member);
    const lowest = getLowestSuccessRateTypes(memberSuccessRate, 1, 1);
    console.log(`👤 ${member}의 성공률이 가장 낮은 유형:`, lowest);
  }

  console.log("4. 이번주 MVP");
  const f1Stats = calculateF1Scores(memberStats);
  console.table(f1Stats);
  const mvps = getMVPByF1(f1Stats);
  console.log("🏆 F1 기준 MVP:", mvps);

  return { memberStats, lowestTypes, mvps };
}

// Lambda에서 실행될 핸들러
const handler = async (event) => {
  const today = getTodayKST_ISO();
  const problems = await getWeekdayProblemsFromNotion(today);
  const analysis = await analyzeWeeklyStudy(problems);
  await sendDiscord({ ...analysis, problems });
  return { statusCode: 200, body: JSON.stringify(analysis) };
};

// Lambda용 모듈 export
module.exports = { handler };
