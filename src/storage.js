export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ScenesDB', 1);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('scenes')) {
        db.createObjectStore('scenes', { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

export async function saveScene({ preset, name, onSuccess, onError }) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction('scenes', 'readwrite');
    const store = transaction.objectStore('scenes');

    const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
    const newScene = { id, name, preset };

    const request = store.add(newScene);

    request.onsuccess = () => {
      onSuccess(newScene);
    };

    request.onerror = (event) => {
      onError(event.target.error);
    };
  } catch (error) {
    onError(error);
  }
}

export async function updateScene({ id, updatedData, onSuccess, onError }) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction('scenes', 'readwrite');
    const store = transaction.objectStore('scenes');

    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const scene = getRequest.result;
      if (scene) {
        const updatedScene = { ...scene, ...updatedData };
        const updateRequest = store.put(updatedScene);

        updateRequest.onsuccess = () => {
          onSuccess(updatedScene);
        };

        updateRequest.onerror = (event) => {
          onError(event.target.error);
        };
      } else {
        onError('Scene not found');
      }
    };

    getRequest.onerror = (event) => {
      onError(event.target.error);
    };
  } catch (error) {
    onError(error);
  }
}

export async function renameScene({ id, newName, onSuccess, onError }) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction('scenes', 'readwrite');
    const store = transaction.objectStore('scenes');

    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const scene = getRequest.result;
      if (scene) {
        scene.name = newName;
        const updateRequest = store.put(scene);

        updateRequest.onsuccess = () => {
          onSuccess(scene);
        };

        updateRequest.onerror = (event) => {
          onError(event.target.error);
        };
      } else {
        onError('Scene not found');
      }
    };

    getRequest.onerror = (event) => {
      onError(event.target.error);
    };
  } catch (error) {
    onError(error);
  }
}

export async function listScenes({ onSuccess, onError }) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction('scenes', 'readonly');
    const store = transaction.objectStore('scenes');

    const request = store.getAll();

    request.onsuccess = () => {
      onSuccess(request.result);
    };

    request.onerror = (event) => {
      onError(event.target.error);
    };
  } catch (error) {
    onError(error);
  }
}

export async function loadScene({ id, onSuccess, onError }) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction('scenes', 'readonly');
    const store = transaction.objectStore('scenes');

    const request = store.get(id);

    request.onsuccess = () => {
      const scene = request.result;
      if (scene) {
        onSuccess(scene);
      } else {
        onError('Scene not found');
      }
    };

    request.onerror = (event) => {
      onError(event.target.error);
    };
  } catch (error) {
    onError(error);
  }
}

export async function deleteScene({ id, onSuccess, onError }) {
  try {
    const db = await openDatabase();
    const transaction = db.transaction('scenes', 'readwrite');
    const store = transaction.objectStore('scenes');

    const request = store.delete(id);

    request.onsuccess = () => {
      onSuccess(`Scene ${id} was deleted`);
    };

    request.onerror = (event) => {
      onError("Couldn't delete that Scene");
    };
  } catch (error) {
    onError(error);
  }
}
