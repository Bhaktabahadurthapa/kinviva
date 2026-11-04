import React from 'react';
import {AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {c, f} from './theme';
import {AppShot, Callout, Label, Logo, Rect, Stage, useIn} from './ui';

const MAIN = {w: 2400, h: 1494}; // window title bar cropped off
const VIEW = {w: 1700, h: 1105};
const FULL: Rect = {x: 0, y: 0, w: 2400, h: 1494};
const centered: React.CSSProperties = {position: 'absolute', left: (1920 - VIEW.w) / 2, top: (1080 - VIEW.h) / 2 + 8};

export const Intro: React.FC = () => {
	const frame = useCurrentFrame();
	const logo = useIn(0, 14);
	const word = useIn(8);
	const tag = useIn(22);
	const line = interpolate(frame, [18, 50], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
	return (
		<Stage glow={[50, 40]}>
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column'}}>
				<div style={{transform: `scale(${0.6 + logo * 0.4})`, opacity: logo}}>
					<Logo size={120} />
				</div>
				<div
					style={{
						fontFamily: f.display,
						fontSize: 150,
						fontWeight: 600,
						letterSpacing: '-0.025em',
						marginTop: 26,
						opacity: word,
						transform: `translateY(${(1 - word) * 30}px)`,
					}}
				>
					Meeting<span style={{fontStyle: 'italic', fontWeight: 400, color: c.signal}}>Lens</span>
				</div>
				<div style={{width: 520 * line, height: 2, background: c.signal, margin: '18px 0 26px'}} />
				<div style={{fontSize: 40, color: c.text2, opacity: tag, transform: `translateY(${(1 - tag) * 16}px)`}}>
					Understand every meeting, live.
				</div>
			</AbsoluteFill>
		</Stage>
	);
};

const pains = ['Fast talk.', 'Unfamiliar jargon.', 'A question aimed at you.'];

export const Problem: React.FC = () => {
	const end = useIn(62);
	return (
		<Stage glow={[80, 80]}>
			<AbsoluteFill style={{justifyContent: 'center', paddingLeft: 200}}>
				<Label color={c.signal}>The moment</Label>
				{pains.map((p, i) => (
					<Pain key={p} text={p} delay={8 + i * 14} />
				))}
				<div style={{fontSize: 36, color: c.text2, marginTop: 34, opacity: end, transform: `translateX(${(1 - end) * -20}px)`}}>
					MeetingLens listens, explains, and helps you answer.
				</div>
			</AbsoluteFill>
		</Stage>
	);
};

const Pain: React.FC<{text: string; delay: number}> = ({text, delay}) => {
	const p = useIn(delay);
	return (
		<div style={{fontFamily: f.display, fontSize: 96, fontWeight: 500, lineHeight: 1.12, letterSpacing: '-0.02em', opacity: p, transform: `translateY(${(1 - p) * 30}px)`}}>
			{text}
		</div>
	);
};

export const Listening: React.FC = () => (
	<Stage>
		<AppShot src="live-partial.png" img={MAIN} view={VIEW} from={FULL} to={{x: 380, y: 120, w: 1500, h: 760}} moveStart={30} style={centered} highlight={{x: 452, y: 434, w: 990, h: 230}} />
		<Callout
			kicker="01 · Live transcript"
			title={<>Them and Me, captured separately</>}
			body="System audio and your mic stream in as live partial text, then settle into final lines."
			delay={70}
			style={{left: 70, bottom: 56}}
		/>
		<RealBadge />
	</Stage>
);

export const Explain: React.FC = () => (
	<Stage glow={[85, 25]}>
		<AppShot src="live-answered.png" img={MAIN} view={VIEW} from={FULL} to={{x: 900, y: 224, w: 1500, h: 700}} moveStart={18} style={centered} highlight={{x: 1520, y: 302, w: 830, h: 508}} />
		<Callout
			kicker="02 · Explain"
			title={<>The latest point, in plain English</>}
			body="Short sentences that keep the speaker's meaning, and flag anything the transcript left unclear."
			delay={60}
			style={{left: 70, bottom: 70}}
		/>
	</Stage>
);

export const Reply: React.FC = () => (
	<Stage glow={[85, 75]}>
		<AppShot src="live-answered.png" img={MAIN} view={VIEW} from={{x: 900, y: 224, w: 1500, h: 700}} to={{x: 900, y: 694, w: 1500, h: 700}} moveStart={6} moveFrames={36} style={centered} highlight={{x: 1520, y: 848, w: 830, h: 460}} />
		<Callout
			kicker="03 · Suggest reply"
			title={<>A short draft you review and edit</>}
			body="Grounded in the transcript and your notes. It never invents your experience, and nothing is sent for you."
			delay={44}
			style={{left: 70, bottom: 70}}
		/>
	</Stage>
);

export const Overlay: React.FC = () => {
	const p = useIn(10, 16);
	return (
		<Stage glow={[30, 50]}>
			<AbsoluteFill style={{filter: 'blur(6px) brightness(0.45)'}}>
				<Img src={staticFile('live-answered.png')} style={{width: 1920, height: 1195, objectFit: 'cover'}} />
			</AbsoluteFill>
			<div
				style={{
					position: 'absolute',
					right: 230,
					top: 90,
					width: 630,
					height: 840,
					borderRadius: 22,
					overflow: 'hidden',
					transform: `translateY(${(1 - p) * 60}px) scale(${0.94 + p * 0.06})`,
					opacity: p,
					boxShadow: '0 50px 100px -30px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.06)',
				}}
			>
				<Img src={staticFile('overlay.png')} style={{width: 630, height: 840}} />
			</div>
			<Callout
				kicker="04 · Overlay"
				title={<>Always on top, beside your call</>}
				body="A compact, movable window with the latest lines, the explanation and your reply."
				delay={40}
				style={{left: 120, top: 330}}
			/>
		</Stage>
	);
};

export const History: React.FC = () => (
	<Stage glow={[20, 80]}>
		<AppShot src="history.png" img={MAIN} view={VIEW} from={{x: 300, y: 134, w: 2100, h: 1360}} to={{x: 380, y: 194, w: 1900, h: 1240}} moveStart={0} moveFrames={110} style={centered} />
		<Callout
			kicker="05 · History"
			title={<>Saved on your Mac</>}
			body="Every meeting goes to a local SQLite database: search it, reopen it in the assistant, export Markdown or text."
			delay={26}
			style={{right: 70, bottom: 70}}
		/>
	</Stage>
);

const chips: [string, string][] = [
	['Speech', 'whisper.cpp on device · or Deepgram'],
	['AI', 'Ollama on device · or any OpenAI-compatible API'],
	['Keys', 'Stored in the macOS Keychain'],
	['Privacy', 'No telemetry · recordings off by default'],
];

export const Privacy: React.FC = () => (
	<Stage glow={[50, 100]}>
		<AbsoluteFill style={{justifyContent: 'center', paddingLeft: 200, paddingRight: 200}}>
			<Label color={c.signal}>Local-first by design</Label>
			<div style={{fontFamily: f.display, fontSize: 84, fontWeight: 500, letterSpacing: '-0.02em', margin: '14px 0 40px'}}>Your meeting stays yours.</div>
			<div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22}}>
				{chips.map(([k, v], i) => (
					<Chip key={k} k={k} v={v} delay={14 + i * 8} />
				))}
			</div>
		</AbsoluteFill>
	</Stage>
);

const Chip: React.FC<{k: string; v: string; delay: number}> = ({k, v, delay}) => {
	const p = useIn(delay);
	return (
		<div
			style={{
				opacity: p,
				transform: `translateY(${(1 - p) * 20}px)`,
				border: `1px solid ${c.lineStrong}`,
				background: c.surface,
				borderRadius: 14,
				padding: '22px 26px',
				display: 'flex',
				gap: 22,
				alignItems: 'baseline',
			}}
		>
			<Label color={c.ok} style={{minWidth: 110}}>
				{k}
			</Label>
			<span style={{fontSize: 30, color: c.text}}>{v}</span>
		</div>
	);
};

export const Outro: React.FC = () => {
	const a = useIn(0, 16);
	const b = useIn(16);
	const d = useIn(34);
	return (
		<Stage glow={[50, 45]}>
			<AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', flexDirection: 'column'}}>
				<div style={{display: 'flex', alignItems: 'center', gap: 28, opacity: a, transform: `scale(${0.9 + a * 0.1})`}}>
					<Logo size={96} />
					<div style={{fontFamily: f.display, fontSize: 112, fontWeight: 600, letterSpacing: '-0.025em'}}>
						Meeting<span style={{fontStyle: 'italic', fontWeight: 400, color: c.signal}}>Lens</span>
					</div>
				</div>
				<div
					style={{
						marginTop: 40,
						opacity: b,
						fontFamily: f.mono,
						fontSize: 32,
						color: c.text,
						border: `1px solid ${c.lineStrong}`,
						borderRadius: 12,
						padding: '16px 28px',
						background: c.surface,
					}}
				>
					github.com/Bhaktabahadurthapa/meetinglens
				</div>
				<div style={{marginTop: 54, opacity: d, display: 'flex', alignItems: 'center', gap: 18, fontSize: 34, color: c.text2}}>
					Made by
					<span style={{display: 'inline-flex', alignItems: 'center', gap: 12, color: '#fff', fontWeight: 700, letterSpacing: '0.03em'}}>
						<span style={{width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg, #2f7bff, #1fd18b)'}} />
						BKT AI
					</span>
					· subscribe for more AI builds
				</div>
			</AbsoluteFill>
		</Stage>
	);
};

/** Honesty marker: these are captures from the real app. */
const RealBadge: React.FC = () => {
	const p = useIn(8);
	return (
		<div
			style={{
				position: 'absolute',
				left: 70,
				top: 40,
				opacity: p * 0.9,
				fontFamily: f.mono,
				fontSize: 18,
				letterSpacing: '0.08em',
				color: c.text3,
			}}
		>
			REAL APP · macOS · local whisper.cpp + Ollama
		</div>
	);
};
