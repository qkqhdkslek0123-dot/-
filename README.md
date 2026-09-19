# pump.fun 자동매매 봇

pump.fun 본딩커브 토큰을 대상으로 신규 상장을 감지하고, 조건에 맞으면 자동으로
매수/매도하는 봇입니다. [PumpPortal](https://pumpportal.fun) WebSocket으로 신규 토큰을
감지하고, PumpPortal **Local Trading API**(비수탁형 — 개인키가 서버로 전송되지 않고
로컬에서 직접 서명)로 매매를 실행합니다.

## ⚠️ 먼저 읽어주세요 (리스크 고지)

- **이 봇은 수익을 보장하지 않습니다.** pump.fun 밈코인 대다수는 러그풀/급락으로 끝납니다.
  신규 토큰 스나이핑 시장은 이미 초저지연 MEV/스나이퍼 봇들이 경쟁하고 있어서,
  개인 소액 봇은 구조적으로 불리한 위치에 있습니다.
- **투입한 자금은 전액 손실될 수 있다고 가정하고 사용하세요.** `config.yaml`의
  `capital.total_sol`은 "잃어도 생활에 지장 없는 금액"만 넣으세요.
- 슬리피지, 우선순위 수수료(priority fee), PumpPortal 거래 수수료(0.5%) 때문에
  소액 거래일수록 수수료 비중이 커집니다. 예산이 작을수록 실제 기대값은 더 불리합니다.
- **반드시 `DRY_RUN=true`(기본값) 상태로 최소 며칠간 로그를 관찰하며 전략 파라미터를
  검증한 뒤에만 실거래로 전환하세요.**
- pump.fun 이용약관 및 거주 국가의 관련 법규(자동화 거래, 시세조종 관련 규제 등)를
  본인 책임하에 확인하세요.
- 본딩커브 그래주에이션 기준 시가총액(`screening.graduation_market_cap_sol`) 등
  pump.fun의 정책 수치는 예고 없이 바뀔 수 있으니, 실거래 전 공식 자료로 최신값을
  확인하세요.

## 아키텍처

```
src/
  index.ts           메인 루프 (오케스트레이션)
  config.ts           .env + config.yaml 로더
  types.ts            공용 타입
  monitor.ts           PumpPortal WebSocket 구독, 신규 토큰 감지 + 가격 스트림
  filters.ts           스크리닝 조건 (본딩커브 진행률, 시총, 매수자 수, 매집도 등)
  riskManager.ts        일일 손실 한도 킬스위치, 동시 포지션 수 제한, 포지션 사이징
  trader.ts             PumpPortal Local Trading API 호출 + 로컬 서명/전송
  positionManager.ts     포지션 오픈/모니터링/분할 익절·손절·트레일링스탑·타임아웃 청산
  notifier.ts            텔레그램 알림
  db.ts                 SQLite 거래 기록 및 포지션 상태 저장
```

## 설치

```bash
npm install
cp .env.example .env
```

`.env`를 열어 최소한 다음을 채우세요:

- `RPC_URL`: 무료 공개 RPC는 지연/제한이 심하니 Helius/QuickNode 등 사용 권장
- `WALLET_PRIVATE_KEY`: 실거래 전환 시에만 필요 (base58). **절대 커밋/공유 금지**
- (선택) `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`: 매매 알림용
- (선택) `PUMPPORTAL_API_KEY`: 우선순위 처리가 필요하면 발급

`config.yaml`에서 예산에 맞게 `capital.total_sol`(원화 10만원 상당을 SOL로 환산한 값)과
`capital.position_size_pct`, `screening.*` 스크리닝 조건을 조정하세요.

## 실행

```bash
# 1단계: 반드시 DRY_RUN(기본값)으로 먼저 돌려서 로직/필터 동작을 검증
npm run dev

# 로그 확인
tail -f logs/bot.log
```

며칠간 DRY_RUN 로그에서 스크리닝 통과율, 시뮬레이션 매매 빈도, 조건 적절성을
검토한 뒤에만:

```bash
# .env 에서 DRY_RUN=false 로 변경, WALLET_PRIVATE_KEY 설정 후
npm run build
npm start
```

## 매매 전략 요약 (기본값)

- **진입**: 본딩커브 진행률 3~35%, 시총 5~60 SOL, 생성 후 120초 이내, 초기 매수자 5명↑,
  단일 지갑 매집 25% 이하, 개발자 보유 15% 이하, 블랙리스트 미포함
- **청산**: +50%/+100%/+200% 단계별 분할 익절, -20% 손절, 고점 대비 -15% 트레일링 스탑,
  15분 타임아웃 강제 청산
- **리스크 관리**: 동시 최대 2포지션, 일일 손실 한도 도달 시 킬스위치(신규 매수 중단)

모든 수치는 `config.yaml`에서 조정 가능합니다. 이 기본값은 "출발점"일 뿐이며,
백테스트/DRY_RUN 데이터 없이 그대로 실거래에 쓰는 것은 권장하지 않습니다.

## 개발자 블랙리스트

`data/dev_blacklist.json`에 과거 러그풀 등으로 확인된 생성자(dev) 지갑 주소를
JSON 문자열 배열로 추가하면 해당 지갑이 만든 토큰은 자동으로 제외됩니다.

## 알려진 한계

- 매집도(`topHolderPct`)와 개발자 보유율(`devHoldingPct`)은 관찰 윈도우 동안 수집한
  실시간 거래 이벤트를 기반으로 한 **근사치**이며, 온체인 홀더 테이블을 직접 조회한
  정확한 수치가 아닙니다. 더 정밀한 필터링이 필요하면 Bitquery/Solana Tracker 같은
  인덱싱 API를 추가로 연동하는 것을 고려하세요.
- 러그풀/허니팟(매도 불가 토큰) 탐지 로직은 포함되어 있지 않습니다. 별도의 시뮬레이션
  매도(dry-sell) 체크 없이는 매도 자체가 막힌 토큰을 걸러낼 수 없습니다.
- 경쟁이 심한 신규 토큰 스나이핑은 RPC/네트워크 지연에 매우 민감합니다. 저지연 RPC를
  쓰지 않으면 필터를 통과해도 매수 트랜잭션이 늦게 체결되거나 실패할 확률이 높습니다.
