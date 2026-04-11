/* ── 5구간 스윔레인 정의 ── */

export const LANE_H = 200;    // 각 레인 높이 (px)
export const LANE_GAP = 3;    // 레인 간 구분선 두께
export const LANE_W = 4000;   // 충분히 넓게
export const LANE_X = 0;      // 레인 시작 X
export const LANE_LABEL_W = 120; // 왼쪽 레인 레이블 너비

export interface LaneDef {
  id: string;
  label: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

export const LANE_DEFS: readonly LaneDef[] = [
  {
    id: 'lane-init',
    label: '변수초기화',
    bgColor: 'rgba(29,78,216,0.09)',
    textColor: '#60a5fa',
    borderColor: 'rgba(59,130,246,0.35)',
  },
  {
    id: 'lane-valid',
    label: '입력값검증',
    bgColor: 'rgba(5,150,105,0.09)',
    textColor: '#34d399',
    borderColor: 'rgba(52,211,153,0.35)',
  },
  {
    id: 'lane-main',
    label: '메인업무처리',
    bgColor: 'rgba(217,119,6,0.09)',
    textColor: '#fbbf24',
    borderColor: 'rgba(251,191,36,0.35)',
  },
  {
    id: 'lane-normal',
    label: '정상처리',
    bgColor: 'rgba(20,184,166,0.09)',
    textColor: '#2dd4bf',
    borderColor: 'rgba(45,212,191,0.35)',
  },
  {
    id: 'lane-error',
    label: '오류처리',
    bgColor: 'rgba(220,38,38,0.09)',
    textColor: '#f87171',
    borderColor: 'rgba(248,113,113,0.35)',
  },
] as const;

export const LANE_ID_SET = new Set(LANE_DEFS.map(l => l.id));

export function getLaneIndex(laneId: string): number {
  return LANE_DEFS.findIndex(l => l.id === laneId);
}

export function laneTopY(idx: number): number {
  return idx * (LANE_H + LANE_GAP);
}

/** 레인의 Y 중심 (노드 배치 기준) */
export function laneCenterY(laneId: string): number {
  const i = getLaneIndex(laneId);
  return laneTopY(i >= 0 ? i : 2) + LANE_H / 2;
}

/** 키워드 기반 자동 레인 추정 */
export function guessLane(
  nodeId: string,
  label: string,
  isFirst: boolean,
  isLast: boolean,
): string {
  const txt = (nodeId + ' ' + label).toLowerCase();

  if (txt.match(/예외|오류|에러|error|exception|실패|fail|timeout|타임아웃|거부|deny|reject|rollback|롤백|재시도|retry|통신 오류|알림|처리 불가/)) {
    return 'lane-error';
  }
  if (txt.match(/완료|success|정상|종료|complete|finish|처리 완료|결과 반환|응답 반환|end\b/)) {
    return 'lane-normal';
  }
  if (isLast) return 'lane-normal';

  if (isFirst || txt.match(/초기|init|선언|생성|수신|start|시작|load|연결|open|설정|구성/)) {
    return 'lane-init';
  }
  if (txt.match(/검증|valid|check|확인|verify|인증|auth|권한|한도|limit|허용|유효|조회|inspect/)) {
    return 'lane-valid';
  }
  return 'lane-main';
}
