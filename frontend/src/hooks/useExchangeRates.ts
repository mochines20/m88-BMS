import { useState, useEffect, useRef } from 'react';

export type SupportedCurrency = 'PHP' | 'USD' | 'IDR';

interface ExchangeRates {
  PHP: number;
  USD: number;
  IDR: number;
}

interface UseExchangeRatesResult {
  rates: ExchangeRates;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const FALLBACK_RATES: ExchangeRates = { PHP: 1, USD: 0.018, IDR: 291 };

let cachedRates: ExchangeRates | null = null;
let cacheTimestamp = 0;

export function useExchangeRates(): UseExchangeRatesResult {
  const [rates, setRates] = useState<ExchangeRates>(cachedRates ?? FALLBACK_RATES);
  const [loading, setLoading] = useState(!cachedRates);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(cachedRates ? new Date(cacheTimestamp) : null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const now = Date.now();
    if (cachedRates && now - cacheTimestamp < CACHE_TTL_MS) {
      setRates(cachedRates);
      setLastUpdated(new Date(cacheTimestamp));
      setLoading(false);
      return;
    }

    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);

    // Primary: fawazahmed0 CDN (no API key, free, real-time)
    const primary = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/php.json`;
    // Fallback: Cloudflare Pages mirror
    const fallback = `https://latest.currency-api.pages.dev/v1/currencies/php.json`;

    const fetchRates = async (url: string) => {
      const res = await fetch(url, { signal: abortRef.current!.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };

    (async () => {
      try {
        let data: any;
        try {
          data = await fetchRates(primary);
        } catch {
          data = await fetchRates(fallback);
        }

        // data.php is the rates object with PHP as base (so php.php = 1)
        const phpRates = data?.php;
        if (!phpRates) throw new Error('Invalid response format');

        const newRates: ExchangeRates = {
          PHP: 1,
          USD: Number(phpRates['usd']) || FALLBACK_RATES.USD,
          IDR: Number(phpRates['idr']) || FALLBACK_RATES.IDR,
        };

        cachedRates = newRates;
        cacheTimestamp = Date.now();

        setRates(newRates);
        setLastUpdated(new Date());
        setError(null);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.warn('[FX] Failed to fetch live rates, using fallback:', err?.message);
        setRates(FALLBACK_RATES);
        setError('Using cached rates');
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { rates, loading, error, lastUpdated };
}
