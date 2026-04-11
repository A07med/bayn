import { useState, useRef, useCallback } from 'react';

export function useTimer() {
  const [elapsed, setElapsed] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef(null);
  const startTimeRef = useRef(null);
  const accumulatedRef = useRef(0);

  const start = useCallback(() => {
    if (intervalRef.current) return;
    startTimeRef.current = Date.now();
    setIsRunning(true);
    intervalRef.current = setInterval(() => {
      const now = Date.now();
      setElapsed(accumulatedRef.current + (now - startTimeRef.current) / 1000);
    }, 50);
  }, []);

  const pause = useCallback(() => {
    if (!intervalRef.current) return;
    accumulatedRef.current += (Date.now() - startTimeRef.current) / 1000;
    clearInterval(intervalRef.current);
    intervalRef.current = null;
    setIsRunning(false);
    setElapsed(accumulatedRef.current);
  }, []);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      accumulatedRef.current += (Date.now() - startTimeRef.current) / 1000;
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    setElapsed(accumulatedRef.current);
    return accumulatedRef.current;
  }, []);

  const addPenalty = useCallback((seconds) => {
    accumulatedRef.current += seconds;
    if (startTimeRef.current && intervalRef.current) {
      setElapsed(accumulatedRef.current + (Date.now() - startTimeRef.current) / 1000);
    } else {
      setElapsed(accumulatedRef.current);
    }
  }, []);

  const reset = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    startTimeRef.current = null;
    accumulatedRef.current = 0;
    setElapsed(0);
    setIsRunning(false);
  }, []);

  return { elapsed, isRunning, start, pause, stop, addPenalty, reset };
}
