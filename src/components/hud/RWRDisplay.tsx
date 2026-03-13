const RWR_SIZE = 240
const CENTER = RWR_SIZE / 2
const OUTER_R = 100
const INNER_R = 30

export function RWRDisplay() {
  return (
    <div className="rwr-panel">
      <div className="rwr-header">
        <span className="rwr-title">RWR</span>
        <span className="rwr-status">FRAME</span>
      </div>
      <svg
        viewBox={`0 0 ${RWR_SIZE} ${RWR_SIZE}`}
        className="rwr-scope"
        width={RWR_SIZE}
        height={RWR_SIZE}
      >
        <circle cx={CENTER} cy={CENTER} r={OUTER_R} className="rwr-ring" />
        <circle cx={CENTER} cy={CENTER} r={(OUTER_R + INNER_R) / 2} className="rwr-ring rwr-ring-mid" />
        <circle cx={CENTER} cy={CENTER} r={INNER_R} className="rwr-ring" />

        <line x1={CENTER} y1={CENTER - OUTER_R - 5} x2={CENTER} y2={CENTER - OUTER_R + 10} className="rwr-tick" />
        <line x1={CENTER + OUTER_R + 5} y1={CENTER} x2={CENTER + OUTER_R - 10} y2={CENTER} className="rwr-tick" />
        <line x1={CENTER} y1={CENTER + OUTER_R + 5} x2={CENTER} y2={CENTER + OUTER_R - 10} className="rwr-tick" />
        <line x1={CENTER - OUTER_R - 5} y1={CENTER} x2={CENTER - OUTER_R + 10} y2={CENTER} className="rwr-tick" />

        <circle cx={CENTER} cy={CENTER} r={3} className="rwr-center-dot" />

        <text x={CENTER} y={CENTER - OUTER_R - 8} textAnchor="middle" className="rwr-cardinal">12</text>
        <text x={CENTER + OUTER_R + 10} y={CENTER + 4} textAnchor="start" className="rwr-cardinal">3</text>
        <text x={CENTER} y={CENTER + OUTER_R + 16} textAnchor="middle" className="rwr-cardinal">6</text>
        <text x={CENTER - OUTER_R - 10} y={CENTER + 4} textAnchor="end" className="rwr-cardinal">9</text>
      </svg>
    </div>
  )
}
