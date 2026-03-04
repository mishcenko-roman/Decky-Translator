// Real internet connectivity check (not only network-interface status).

import { useState, useEffect, useCallback, useRef } from 'react';
import { logger } from '../../Logger';

// Probe multiple providers to reduce false offline in DNS/firewall-restricted networks.
const CHECK_URLS = [
    'https://www.gstatic.com/generate_204',
    'https://cp.cloudflare.com/generate_204',
    'https://connectivitycheck.gstatic.com/generate_204',
];
const CHECK_TIMEOUT_MS = 4000;
const RECHECK_INTERVAL_MS = 20000; // re-probe every 20s while mounted

async function probeUrl(url: string): Promise<boolean> {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
        await fetch(url, {
            method: 'HEAD',
            mode: 'no-cors',
            cache: 'no-store',
            signal: controller.signal,
        });
        logger.debug('OnlineStatus', `Connectivity probe success: ${url}`);
        return true;
    } catch {
        logger.debug('OnlineStatus', `Connectivity probe failed: ${url}`);
        return false;
    } finally {
        clearTimeout(tid);
    }
}

async function probeConnectivity(): Promise<boolean> {
    // Fast path when the browser already reports no interface connectivity.
    if (!navigator.onLine) return false;

    for (const url of CHECK_URLS) {
        if (await probeUrl(url)) {
            logger.debug('OnlineStatus', 'Connectivity probe: ONLINE');
            return true;
        }
    }

    logger.debug('OnlineStatus', 'Connectivity probe: OFFLINE (all probes failed)');
    return false;
}

/** Real internet connectivity status with periodic and event-driven rechecks. */
export function useRealOnlineStatus(): boolean {
    // Fast initial guess to avoid transient offline flicker on mount.
    const [isOnline, setIsOnline] = useState(() => navigator.onLine);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const recheck = useCallback(() => {
        probeConnectivity().then(online => setIsOnline(online));
    }, []);

    useEffect(() => {
        recheck();
        timerRef.current = setInterval(recheck, RECHECK_INTERVAL_MS);
        window.addEventListener('online', recheck);
        window.addEventListener('offline', recheck);

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            window.removeEventListener('online', recheck);
            window.removeEventListener('offline', recheck);
        };
    }, [recheck]);

    return isOnline;
}
