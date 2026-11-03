import {linearTiming, TransitionSeries} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import React from 'react';
import {AbsoluteFill, Composition} from 'remotion';
import {Branding} from './Branding';
import {FontGate} from './Fonts';
import {Explain, History, Intro, Listening, Outro, Overlay, Privacy, Problem, Reply} from './scenes';
import {FPS, TRANSITION} from './theme';

const SCENES: [React.FC, number][] = [
	[Intro, 105],
	[Problem, 105],
	[Listening, 165],
	[Explain, 150],
	[Reply, 135],
	[Overlay, 130],
	[History, 130],
	[Privacy, 125],
	[Outro, 150],
];

const TOTAL = SCENES.reduce((s, [, d]) => s + d, 0) - TRANSITION * (SCENES.length - 1);

const Demo: React.FC = () => (
	<FontGate>
		<AbsoluteFill style={{background: '#110f0d'}}>
			<TransitionSeries>
				{SCENES.flatMap(([Scene, d], i) => [
					...(i > 0
						? [<TransitionSeries.Transition key={`t${i}`} timing={linearTiming({durationInFrames: TRANSITION})} presentation={fade()} />]
						: []),
					<TransitionSeries.Sequence key={`s${i}`} durationInFrames={d}>
						<Scene />
					</TransitionSeries.Sequence>,
				])}
			</TransitionSeries>
			<Branding />
		</AbsoluteFill>
	</FontGate>
);

export const Root: React.FC = () => (
	<Composition id="MeetingLensDemo" component={Demo} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
);
