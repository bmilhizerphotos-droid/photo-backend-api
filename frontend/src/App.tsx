import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchPhotos, getAuthenticatedImageUrl, Photo, preloadImage } from './api';
import { auth, signInWithGoogle, signInWithGoogleRedirect, signOutUser } from './firebase';
import { getRedirectResult } from 'firebase/auth';
import { onAuthStateChanged, User } from 'firebase/auth';

type ViewType = 'photos' | 'people' | 'memories' | 'shared';

function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [selectedPhotoUrl, setSelectedPhotoUrl] = useState<string>('');
  const [currentView, setCurrentView] = useState<ViewType>('photos');
  const [modalLoading, setModalLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [avatarError, setAvatarError] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);

  const observer = useRef<IntersectionObserver | null>(null);
  const LIMIT = 50;

  // Authentication handlers
  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error: any) {
      console.error('Popup authentication failed:', error.message);

      // If popup fails due to browser security policies, try redirect
      if (error.message.includes('Cross-Origin') || error.message.includes('blocked') || error.code === 'auth/popup-blocked') {
        console.log('Trying redirect authentication...');
        try {
          await signInWithGoogleRedirect();
          // Page will redirect to Google, then back to our app
        } catch (redirectError: any) {
          console.error('Redirect authentication also failed:', redirectError);
          alert('Authentication failed. Please try:\n1. Use an incognito/private window\n2. Disable popup blockers temporarily\n3. Use a different browser (Chrome recommended)');
        }
      } else {
        // Other errors (user cancelled, etc.)
        console.log('Authentication cancelled or other error');
      }
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutUser();
      setPhotos([]);
      setOffset(0);
      setHasMore(true);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  // Load photos with infinite scroll
  const loadPhotos = useCallback(async () => {
    if (loading || !hasMore || currentView !== 'photos' || !user) return;

    setLoading(true);
    try {
      const data = await fetchPhotos(offset, LIMIT);

      if (data.length < LIMIT) {
        setHasMore(false);
      }

      setPhotos(prev => [...prev, ...data]);
      setOffset(prev => prev + LIMIT);
    } catch (err) {
      console.error("Error fetching photos:", err);
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, currentView]);

  // Handle redirect authentication result
  useEffect(() => {
    const handleRedirectResult = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
          console.log('Redirect authentication successful for:', result.user.displayName);
        }
      } catch (error) {
        // Only log actual errors, not "null" results
        if (error && typeof error === 'object' && 'code' in error) {
          console.error('Redirect authentication error:', error);
        }
      }
    };

    handleRedirectResult();
  }, []);

  // Authentication state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setAuthLoading(false);
      setAvatarError(false); // Reset avatar error on user change
      setAvatarLoading(true);

      // Preload avatar image to check if it loads
      if (user?.photoURL) {
        const img = new Image();
        img.onload = () => {
          setAvatarLoading(false);
          setAvatarError(false);
        };
        img.onerror = () => {
          console.log('Avatar failed to load, using fallback');
          setAvatarLoading(false);
          setAvatarError(true);
        };
        img.src = user.photoURL;
      } else {
        setAvatarLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Initial load and view changes - only when authenticated
  useEffect(() => {
    if (currentView === 'photos' && user) {
      loadPhotos();
    } else if (!user) {
      // Reset when not authenticated
      setPhotos([]);
      setOffset(0);
      setHasMore(true);
    } else {
      // Reset for other views
      setPhotos([]);
      setOffset(0);
      setHasMore(false);
    }
  }, [currentView, user, loadPhotos]);

  // Infinite scroll observer
  const lastPhotoElementRef = useCallback((node: HTMLDivElement | null) => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();

    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && currentView === 'photos') {
        loadPhotos();
      }
    });

    if (node) observer.current.observe(node);
  }, [loading, hasMore, loadPhotos, currentView]);

  // Handle photo click for modal
  const handlePhotoClick = async (photo: Photo) => {
    setSelectedPhoto(photo);
    setModalLoading(true);

    try {
      const authenticatedUrl = await getAuthenticatedImageUrl(photo.fullUrl);
      setSelectedPhotoUrl(authenticatedUrl);

      // Preload the full-size image
      await preloadImage(authenticatedUrl);
    } catch (err) {
      console.error("Error loading full-size image:", err);
      setSelectedPhotoUrl(photo.fullUrl); // Fallback to original URL
    } finally {
      setModalLoading(false);
    }
  };

  // Close modal
  const closeModal = () => {
    setSelectedPhoto(null);
    setSelectedPhotoUrl('');
    setModalLoading(false);
  };

  // Placeholder content for other views
  const renderPlaceholderView = (title: string, icon: string) => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-gray-400">
      <div className="text-6xl mb-4">{icon}</div>
      <h2 className="text-xl font-medium mb-2">{title}</h2>
      <p className="text-center max-w-md">
        This feature is coming soon. For now, enjoy browsing your photo collection!
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <h1 className="text-xl font-semibold text-gray-900">Photos</h1>
            <div className="flex items-center space-x-4">
              {user ? (
                <>
                  {/* Navigation */}
                  <nav className="flex space-x-8">
                    {[
                      { id: 'photos', label: 'Photos', icon: '🖼️' },
                      { id: 'people', label: 'People', icon: '👥' },
                      { id: 'memories', label: 'Memories', icon: '📅' },
                      { id: 'shared', label: 'Shared', icon: '📤' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        onClick={() => setCurrentView(item.id as ViewType)}
                        className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          currentView === item.id
                            ? 'bg-blue-100 text-blue-700'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                        }`}
                      >
                        <span>{item.icon}</span>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </nav>

                  {/* User Info & Sign Out */}
                  <div className="flex items-center space-x-3">
                    {avatarLoading ? (
                      // Loading placeholder
                      <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse"></div>
                    ) : user.photoURL && !avatarError ? (
                      <img
                        src={user.photoURL}
                        alt={user.displayName || 'User'}
                        className="w-8 h-8 rounded-full"
                        onError={() => {
                          console.log('Avatar error fallback triggered');
                          setAvatarError(true);
                        }}
                      />
                    ) : (
                      // Fallback avatar
                      <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium">
                        {(user.displayName || user.email || 'U')[0].toUpperCase()}
                      </div>
                    )}
                    <span className="text-sm text-gray-700">{user.displayName}</span>
                    <button
                      onClick={handleSignOut}
                      className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1 rounded-md hover:bg-gray-100"
                    >
                      Sign Out
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={handleSignIn}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Sign In with Google
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {authLoading ? (
          /* Authentication Loading */
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="flex items-center space-x-2 text-gray-500">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <span>Loading...</span>
            </div>
          </div>
        ) : !user ? (
          /* Sign In Prompt */
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
            <div className="max-w-md">
              <div className="text-6xl mb-6">📸</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Welcome to Family Photos
              </h2>
              <p className="text-gray-600 mb-8">
                Sign in with Google to view and manage your family photo collection.
              </p>
              <button
                onClick={handleSignIn}
                className="bg-blue-600 text-white px-8 py-3 rounded-lg text-lg font-medium hover:bg-blue-700 transition-colors flex items-center space-x-3 mx-auto"
              >
                <svg className="w-6 h-6" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span>Sign In with Google</span>
              </button>
              <p className="text-sm text-gray-500 mt-4 text-center">
                Uses popup authentication (may redirect if blocked by browser)
              </p>
            </div>
          </div>
        ) : currentView === 'photos' ? (
          <>
            {/* Photo Grid */}
            <div
              className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-7 space-y-6"
              style={{
                columnGap: '28px',
                rowGap: '24px'
              }}
            >
              {photos.map((photo, index) => {
                const isLast = photos.length === index + 1;
                return (
                  <div
                    ref={isLast ? lastPhotoElementRef : null}
                    key={`${photo.id}-${index}`}
                    className="break-inside-avoid cursor-pointer group"
                    onClick={() => handlePhotoClick(photo)}
                  >
                    <div className="relative overflow-hidden rounded-lg bg-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                      <img
                        src={photo.thumbnailUrl}
                        alt={photo.filename}
                        className="w-full h-auto object-cover group-hover:scale-105 transition-transform duration-200"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-10 transition-opacity duration-200" />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Loading States */}
            {loading && (
              <div className="flex justify-center items-center py-12">
                <div className="flex items-center space-x-2 text-gray-500">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                  <span>Loading more photos...</span>
                </div>
              </div>
            )}

            {!hasMore && photos.length > 0 && (
              <div className="text-center py-12 text-gray-500">
                <p>You've reached the end of your collection!</p>
              </div>
            )}

            {photos.length === 0 && !loading && (
              <div className="text-center py-12 text-gray-500">
                <p>No photos found. Check back later!</p>
              </div>
            )}
          </>
        ) : currentView === 'people' ? (
          renderPlaceholderView('People', '👥')
        ) : currentView === 'memories' ? (
          renderPlaceholderView('Memories', '📅')
        ) : (
          renderPlaceholderView('Shared', '📤')
        )}
      </main>

      {/* Full-Screen Modal */}
      {selectedPhoto && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <div className="relative max-w-full max-h-full" onClick={(e) => e.stopPropagation()}>
            {/* Close Button */}
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 z-10 w-10 h-10 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded-full flex items-center justify-center text-xl transition-colors"
            >
              ✕
            </button>

            {/* Loading State */}
            {modalLoading && (
              <div className="flex items-center justify-center w-96 h-96 bg-gray-800 rounded-lg">
                <div className="flex items-center space-x-2 text-white">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                  <span>Loading...</span>
                </div>
              </div>
            )}

            {/* Full-Size Image */}
            {!modalLoading && selectedPhotoUrl && (
              <div className="bg-white rounded-lg overflow-hidden shadow-2xl max-w-5xl max-h-[90vh]">
                <img
                  src={selectedPhotoUrl}
                  alt={selectedPhoto.filename}
                  className="w-full h-auto max-h-[80vh] object-contain"
                />

                {/* Metadata */}
                <div className="p-4 bg-white border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-medium text-gray-900 truncate">
                        {selectedPhoto.filename}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">
                        Photo ID: {selectedPhoto.id}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
