/* `useLocalStorage`
 *
 * Features:
 *  - JSON Serializing
 *  - Also value will be updated everywhere, when value updated (via `storage` event)
 */

import { useEffect, useState } from 'react';

export default function useLocalStorage<T>(key: string, defaultValue: T): [T, (value: T) => void] {
  const [value, setValue] = useState(defaultValue);

  const parseStoredValue = (rawValue: string | null): T => {
    if (rawValue == null) {
      return defaultValue;
    }

    try {
      return JSON.parse(rawValue) as T;
    } catch (error) {
      console.warn(`Failed to parse localStorage value for key "${key}". Resetting to default.`, error);
      localStorage.setItem(key, JSON.stringify(defaultValue));
      return defaultValue;
    }
  };

  useEffect(() => {
    const item = localStorage.getItem(key);

    if (!item) {
      localStorage.setItem(key, JSON.stringify(defaultValue));
    }

    setValue(parseStoredValue(item));

    function handler(e: StorageEvent) {
      if (e.key !== key) {
        return;
      }

      const lsi = localStorage.getItem(key);
      setValue(parseStoredValue(lsi));
    }

    window.addEventListener('storage', handler);

    return () => {
      window.removeEventListener('storage', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setValueWrap = (value: T) => {
    try {
      setValue(value);

      localStorage.setItem(key, JSON.stringify(value));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new StorageEvent('storage', { key }));
      }
    } catch (e) {
      console.error(e);
    }
  };

  return [value, setValueWrap];
}
