import { formatTime } from '../utils';

export default function TimerDisplay({ seconds, isRunning, large = false }) {
  return (
    <div
      className={`timer-display font-mono font-bold tracking-wider ${
        large ? 'text-7xl' : 'text-4xl'
      } ${isRunning ? 'text-green-400' : 'text-gray-400'}`}
    >
      {formatTime(seconds)}
    </div>
  );
}
