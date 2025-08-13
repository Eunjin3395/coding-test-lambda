const fs = require("fs");
const axios = require("axios");
const AWS = require("aws-sdk");
require("dotenv").config();

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const GITHUB_API_URL = process.env.GITHUB_API_URL;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const ASSIGNEES = process.env.ASSIGNEES ? process.env.ASSIGNEES.split(",") : ["Eunjin3395"]; // github 아이디
const PARTICIPANTS = process.env.PARTICIPANTS ? process.env.PARTICIPANTS.split(",") : ["jennyeunjin"]; // solved.ac 아이디
const EXCLUDE_PARTICIPANTS = ["jennyeunjin", "skfnx13"];
const IMP_RANDOM_QUERY_CMN = process.env.IMP_RANDOM_QUERY_CMN; // 공통 구현 쿼리
const IMP_RANDOM_QUERY_INDV = process.env.IMP_RANDOM_QUERY_INDV; // 은진 개인 구현 쿼리

const PARTICIPANTS_TO_ASSIGNEES = {
  jennyeunjin: "Eunjin3395",
  skfnx13: "KII1ua",
  "3veryday": "3veryDay",
  20011211: "jaewon-ju",
  dlchdaud123: "dlchdaud123",
};

const QUERY_FORMAT = process.env.QUERY_FORMAT;

const SOLVEDAC_URL = "https://solved.ac/api/v3/search/problem";
const BAEKJOON_URL = "https://www.acmicpc.net";
const NOTION_PAGE_URL = "https://api.notion.com/v1/pages";

const PROBLEM_HISTORY_TABLE = "ProblemHistory";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const LEVELS = ["UR", "B5", "B4", "B3", "B2", "B1", "S5", "S4", "S3", "S2", "S1", "G5", "G4", "G3", "G2", "G1"];

// pool.json 로드
const POOL = JSON.parse(fs.readFileSync("pool.json", "utf-8"));
const SELECTED_POOL = POOL.selectedPool;
const TOTAL_POOL = POOL.totalPool;

// dynamoDB 연동
const dynamo = new AWS.DynamoDB.DocumentClient({
  region: "ap-northeast-2",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

// KST 기준 오늘 날짜 (YYMMDD)
const getTodayKST = () => {
  return new Date()
    .toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/\.\s?/g, ""); // 공백과 점(.) 제거
};

// KST 기준 오늘 날짜 (YYYY-MM-DD)
const getTodayKST_ISO = () => {
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000; // 한국 시간 UTC+9 적용
  const kstDate = new Date(now.getTime() + kstOffset);
  return kstDate.toISOString().split("T")[0]; // "YYYY-MM-DD" 포맷 반환
};

// KST 기준 오늘 요일
function getKSTDayOfWeekShort() {
  const now = new Date();

  return now.toLocaleDateString("ko-KR", {
    weekday: "short", // '월', '화', '수' 형식
    timeZone: "Asia/Seoul",
  });
}

// 배열 랜덤 섞기
const shuffleArray = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]]; // Swap elements
  }
  return array;
};

// query string 생성
function buildSolvedAcQuery({ tag, min, max, minParticipants }, participants) {
  const participantQuery = participants.map((id) => `+!%40${encodeURIComponent(id)}`).join("");

  const finalQuery = QUERY_FORMAT.replace("{min}", min)
    .replace("{max}", max)
    .replace("{participants}", participantQuery)
    .replace("{minParticipants}", minParticipants)
    .replace("{tag}", encodeURIComponent(tag));

  return finalQuery;
}

// solved.ac에서 문제 검색
const fetchProblemsFromSolvedAc = async (query, count = 1) => {
  try {
    const requestUrl = `${SOLVEDAC_URL}?query=${query}`;
    const response = await axios.get(requestUrl, {
      headers: { "User-Agent": USER_AGENT },
    });

    const items = response.data.items || [];
    if (items.length < count) {
      console.log("❌ 문제 부족:", query);
      return [];
    }

    console.log(`🔍 요청: ${requestUrl}, 조회된 개수: ${items.length}`);

    return items.slice(0, count).map(({ problemId, titleKo, level, tags }) => ({
      id: problemId,
      title: titleKo,
      level: LEVELS[level] || "Unknown",
      type: tags ? tags.flatMap((tag) => tag.displayNames.filter((displayName) => displayName.language === "ko").map((displayName) => displayName.name)) : [],
    }));
  } catch (error) {
    console.error("⚠️ Solved.ac API 에러:", error.message);
    return [];
  }
};

/**
 * 주어진 문제 pool에서 랜덤 태그의 유효한 문제를 랜덤하게 n개 추출
 * @param {Array} pool  문제 후보 풀 (selectedPool 또는 totalPool)
 * @param {int} n 문제 개수
 * @param {Array} participants 쿼리에 포함할 아이디 리스트
 * @returns
 */
const getValidProblemFromPool = async (pool, n, participants) => {
  const shuffledPool = shuffleArray([...pool]); // 랜덤 순서
  const selectedTags = new Set();
  const selectedProblems = [];

  for (const candidate of shuffledPool) {
    const tag = candidate.tag.trim();
    if (selectedTags.has(tag)) continue;

    const query = buildSolvedAcQuery(candidate, participants);
    const problems = await fetchProblemsFromSolvedAc(query, 1);

    if (problems.length > 0) {
      selectedProblems.push(problems[0]);
      selectedTags.add(tag);
    }

    if (selectedProblems.length >= n) break;
  }

  if (selectedProblems.length < n) {
    throw new Error(`❌ 서로 다른 유형의 문제 ${n}개를 찾지 못했습니다. (성공: ${selectedProblems.length})`);
  }

  return {
    problems: selectedProblems,
    tags: [...selectedTags],
  };
};

/**
 * 문제 유형 pool에서 s,t개 랜덤 추출
 * @param {*} s 특정 유형에서 s개 추출
 * @param {*} t 전체 유형에서 t개 추출
 * @returns
 */
const selectRanProblems = async (s, t, participants) => {
  // 1. selectedPool에서 유효한 문제 s개 선택
  const { problems: selectedProblem, tags: selectedTag } = await getValidProblemFromPool(SELECTED_POOL, s, participants);

  // 2. totalPool에서 같은 태그 제외 후 유효한 문제 t개 선택
  const remaining = TOTAL_POOL.filter((p) => p.tag.trim() !== selectedTag);
  const { problems: otherProblem } = await getValidProblemFromPool(remaining, t, participants);

  // 리스트 병합 후 섞어서 반환
  const shuffled_problems = shuffleArray([...selectedProblem, ...otherProblem]);

  return shuffled_problems;
};

/**
 * 공통 구현 문제 랜덤 n개 추출
 * @param {int} n
 */
const selectCommonImpProblems = async (n) => {
  const problem = await fetchProblemsFromSolvedAc(IMP_RANDOM_QUERY_CMN, n, true);
  return problem;
};

/**
 * 개인 구현 문제 랜덤 n개 추출
 * @param {int} n
 * @returns
 */
const selectIndvImpProblems = async (n) => {
  const problem = await fetchProblemsFromSolvedAc(IMP_RANDOM_QUERY_INDV, n, true);
  return problem.map((p) => ({
    ...p,
    isCommon: false,
  }));
};

/**
 * 전체 문제 랜덤 추출
 * @param {int} i 구현 문제 개수
 * @param {int} s 특정 유형 문제 개수
 * @param {int} t 전체 유형 문제 개수
 */
const getRandomProblems = async (i, s, t) => {
  try {
    const imp_problems = await selectCommonImpProblems(i);
    const random_problems = await selectRanProblems(s, t);
    const imp_problems_indv = await selectIndvImpProblems(i);
    const problems = [...imp_problems, ...random_problems, ...imp_problems_indv];

    return problems;
  } catch (error) {
    console.error("Error fetching random problems:", error);
    return [];
  }
};

/**
 * 월,화,금요일 공통 문제 및 추가 문제 추출
 * @param {*} i
 * @param {*} s
 * @param {*} t
 */
const getRandomProblems_MTF = async (i, s, t) => {
  let imp_problems = await selectCommonImpProblems(i); // 공통 구현 문제
  imp_problems = imp_problems.map((p) => ({
    ...p,
    isCommon: true,
    assignees: ASSIGNEES,
  }));

  let imp_problems_indv = await selectIndvImpProblems(i); // 추가 구현 문제
  imp_problems_indv = imp_problems_indv.map((p) => ({
    ...p,
    isCommon: false,
    assignees: "Eunjin3395",
  }));

  // 제외할 멤버 및 쿼리 대상 멤버 추출
  const excludeId = EXCLUDE_PARTICIPANTS[Math.floor(Math.random() * EXCLUDE_PARTICIPANTS.length)];
  const participants = PARTICIPANTS.filter((id) => id !== excludeId);
  console.log(`❌ exclude Id: ${excludeId}, participants: ${participants}, assiginees: ${ASSIGNEES}`);

  let type_problems = await selectRanProblems(s, t, participants); // 공통 유형 문제
  type_problems = type_problems.map((p) => ({
    ...p,
    isCommon: true,
    assignees: ASSIGNEES,
  }));

  let type_problems_indv = await selectRanProblems(s, t, [excludeId]); // 추가 유형 문제
  type_problems_indv = type_problems_indv.map((p) => ({
    ...p,
    isCommon: false,
    assignees: PARTICIPANTS_TO_ASSIGNEES[excludeId],
  }));

  const problems = [...imp_problems, ...type_problems, ...imp_problems_indv, ...type_problems_indv];

  return problems;
};

/**
 * 수,목요일 공통 문제 및 추가 문제 추출
 * @param {*} i
 * @param {*} s
 * @param {*} t
 */
const getRandomProblems_WT = async (i, s, t) => {
  let imp_problems = await selectCommonImpProblems(i); // 공통 구현 문제
  imp_problems = imp_problems.map((p) => ({
    ...p,
    isCommon: true,
    assignees: ASSIGNEES,
  }));

  let imp_problems_indv = await selectIndvImpProblems(i); // 추가 구현 문제
  imp_problems_indv = imp_problems_indv.map((p) => ({
    ...p,
    isCommon: false,
    assignees: "Eunjin3395",
  }));

  // 제외할 멤버 및 쿼리 대상 멤버 추출
  const excludeId = "skfnx13";
  const participants = PARTICIPANTS.filter((id) => id !== excludeId);
  const assignees = participants.map((pt) => PARTICIPANTS_TO_ASSIGNEES[pt]);

  let type_problems = await selectRanProblems(s, t, participants); // 공통 유형 문제
  type_problems = type_problems.map((p) => ({
    ...p,
    isCommon: true,
    assignees: assignees,
  }));

  const problems = [...imp_problems, ...type_problems, ...imp_problems_indv];

  return problems;
};

// github issue 생성
const createIssue = async (problemData) => {
  try {
    let issueUrls = [];

    for (const problem of problemData) {
      const problemUrl = `https://www.acmicpc.net/problem/${problem.id}`;
      const isCommon = problem.isCommon ? "⭐️" : "⚡️";
      let issueTitle = `${isCommon} ${getTodayKST()} : [BOJ ${problem.id}] ${problem.title}`;
      const issueBody = `# [${problem.title}](${problemUrl})`;
      const response = await axios.post(
        `${GITHUB_API_URL}/issues`,
        {
          title: issueTitle,
          body: issueBody,
          labels: ["✅ Add"],
          assignees: problem.assignees,
        },
        {
          headers: {
            Authorization: `token ${ACCESS_TOKEN}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "BaekjoonBot",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );

      console.log("Github issue created:", response.data.html_url);
      issueUrls.push(response.data.html_url);
    }

    return { success: true, issueUrls };
  } catch (error) {
    console.error("Error creating GitHub Issue:", error.response ? error.response.data : error.message);
    return { success: false, issueUrls: [] };
  }
};

// 노션 데이터베이스에 추가
const addToNotionDatabase = async (problemData) => {
  try {
    for (const problem of problemData) {
      await axios.post(
        NOTION_PAGE_URL,
        {
          parent: { database_id: NOTION_DATABASE_ID },
          properties: {
            "문제 번호": { title: [{ text: { content: `${problem.id}` } }] },
            날짜: { date: { start: getTodayKST_ISO() } },
            난이도: { select: { name: problem.level } },
            유형: {
              multi_select: problem.type.map((type) => ({ name: type })),
            },
          },
        },
        {
          headers: {
            Authorization: `Bearer ${NOTION_TOKEN}`,
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28",
          },
        }
      );
    }
    console.log("Notion database updated");
    return true;
  } catch (error) {
    console.error("Error adding to Notion database:", error.response ? error.response.data : error.message);
    return false;
  }
};

/**
 * ProblemHistory 테이블에 문제 번호 저장
 * @param {string[]} problemData - 문제 정보 배열
 */
const insertProblemHistory = async (problemData) => {
  const targetDate = getTodayKST_ISO();

  if (!Array.isArray(problemData) || problemData.length === 0) {
    throw new Error("problemData 배열이 비어있거나 유효하지 않습니다.");
  }

  const problems = problemData.map((p) => String(p.id)).filter(Boolean);

  if (problems.length === 0) {
    throw new Error("유효한 문제 id가 없습니다.");
  }

  const params = {
    TableName: PROBLEM_HISTORY_TABLE,
    Item: {
      date: targetDate,
      problems: problems,
    },
  };

  try {
    await dynamo.put(params).promise();
    console.log(`✅ ${targetDate} 문제 목록 저장 완료:`, problems);
  } catch (err) {
    console.error("❌ 문제 저장 실패:", err);
    throw err;
  }
};

// 디스코드 메시지 전송
const sendDiscord = async (problemData, issueUrls, issueSuccess, notionSuccess) => {
  try {
    let message = `## ☀️ ${getTodayKST_ISO()} 오늘의 문제\n\n`;

    problemData.forEach((problem, index) => {
      const problemUrl = `<${BAEKJOON_URL}/problem/${problem.id}>`;
      const isCommon = problem.isCommon ? "⭐️" : "⚡️";

      message += `${isCommon} [BOJ ${problem.id}] ${problem.title}\n`;
      message += `🔗 [문제 바로가기](${problemUrl})\n\n`;
    });

    message += `**GitHub Issue 생성 ** ${issueSuccess ? "✅" : "❌"}\n`;
    message += `**Notion 업데이트 ** ${notionSuccess ? "✅" : "❌"}`;

    await axios.post(DISCORD_WEBHOOK, { content: message });
    console.log("Discord message sent");
  } catch (error) {
    console.error("Error sending discord message:", error);
  }
};

// Lambda에서 실행될 핸들러
const handler = async (event) => {
  // const problemData = await getRandomProblems(1, 1, 1);
  let problemData = [];
  const weekday = getKSTDayOfWeekShort();

  if (weekday === "월" || weekday === "화" || weekday === "금") {
    problemData = await getRandomProblems_MTF(1, 1, 1);
  } else {
    problemData = await getRandomProblems_WT(1, 1, 1);
  }

  console.log(problemData);

  if (!problemData.length) return { statusCode: 500, body: JSON.stringify({ error: "Failed to fetch problem" }) };

  const { success: issueSuccess, issueUrls } = await createIssue(problemData);
  const notionSuccess = await addToNotionDatabase(problemData);
  await insertProblemHistory(problemData);
  await sendDiscord(problemData, issueUrls, issueSuccess, notionSuccess);

  return { statusCode: 200, body: JSON.stringify({ problemData, issueSuccess, notionSuccess }) };
};

// Lambda용 모듈 export
module.exports = { handler };
