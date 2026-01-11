import { useCallback, useEffect, useRef, useState } from "react";

export type Photo = {
  id: string | number;
  filename: string;
  thumbnailUrl: string;
  fullUrl: string;
};

type FetchPhotosFn = (offset: number, limit: number) => Promise<Photo[]>;

export function useInfinitePhotos(fetchPhotos: FetchPhotosFn, pageSize = 50) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const hasMoreRef = useRef(true);
  const offsetRef = useRef(0);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  const reset = useCallback(() => {
    setPhotos([]);
    setOffset(0);
    setHasMore(true);
    setError(null);
    inFlightRef.current = false;
    hasMoreRef.current = true;
    offsetRef.current = 0;
  }, []);

  const loadMore = useCallback(async () => {
    if (inFlightRef.current) return;
    if (!hasMoreRef.current) return;

    inFlightRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const nextOffset = offsetRef.current;
      const batch = await fetchPhotos(nextOffset, pageSize);

      setPhotos((prev) => prev.concat(batch));
      setOffset((prev) => prev + batch.length);

      const more = batch.length === pageSize;
      setHasMore(more);
      hasMoreRef.current = more;
      offsetRef.current = nextOffset + batch.length;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [fetchPhotos, pageSize]);

  return { photos, offset, hasMore, loading, error, reset, loadMore };
}