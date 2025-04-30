import React, { useState, useEffect } from 'react';
import {
  initializeApp
} from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs
} from 'firebase/firestore';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from 'firebase/auth';

// Firebase config from .env
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

export default function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState({ name: '', location: '', squareFootage: '', floors: '' });
  const [quoteItems, setQuoteItems] = useState([{ description: 'Rooftop Unit', qty: 1, unitPrice: 12000 }]);
  const [savedEstimates, setSavedEstimates] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');

  useEffect(() => {
    onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
  }, []);

  const handleLogin = async () => {
    await signInWithPopup(auth, provider);
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleProjectChange = (field, value) => {
    setProject({ ...project, [field]: value });
  };

  const handleItemChange = (index, field, value) => {
    const updated = [...quoteItems];
    updated[index][field] = field === 'qty' || field === 'unitPrice' ? Number(value) : value;
    setQuoteItems(updated);
  };

  const addItem = () => {
    setQuoteItems([...quoteItems, { description: '', qty: 0, unitPrice: 0 }]);
  };

  const removeItem = (index) => {
    setQuoteItems(quoteItems.filter((_, i) => i !== index));
  };

  const total = quoteItems.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);

  const saveEstimate = async () => {
    if (!user) {
      alert("Please log in first.");
      return;
    }

    await addDoc(collection(db, "estimates"), {
      project,
      quoteItems,
      user: user.email,
      timestamp: new Date()
    });

    alert("Estimate saved!");
  };

  const loadEstimates = async () => {
    const querySnapshot = await getDocs(collection(db, "estimates"));
    const data = querySnapshot.docs.map(doc => doc.data());
    setSavedEstimates(data);
  };

  const loadEstimate = (index) => {
    const est = savedEstimates[index];
    if (est) {
      setProject(est.project);
      setQuoteItems(est.quoteItems);
    }
  };

  const handleQuoteUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!selectedCategory || files.length === 0) {
      alert("Please select a category and choose at least one file.");
      return;
    }

    const simulatedParsedItems = files.map((file, i) => ({
      description: `${selectedCategory} - Quote ${i + 1}`,
      qty: 1,
      unitPrice: Math.floor(Math.random() * 5000) + 5000
    }));

    setQuoteItems([...quoteItems, ...simulatedParsedItems]);
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>HVAC Estimator</h1>

      <div>
        {user ? (
          <>
            <p>Welcome, {user.displayName}</p>
            <button onClick={handleLogout}>Logout</button>
          </>
        ) : (
          <button onClick={handleLogin}>Login with Google</button>
        )}
      </div>

      <div style={{ marginTop: '1rem' }}>
        <h2>Project Info</h2>
        <input placeholder="Name" value={project.name} onChange={(e) => handleProjectChange('name', e.target.value)} />
        <input placeholder="Location" value={project.location} onChange={(e) => handleProjectChange('location', e.target.value)} />
        <input placeholder="Square Footage" value={project.squareFootage} onChange={(e) => handleProjectChange('squareFootage', e.target.value)} />
        <input placeholder="Floors" value={project.floors} onChange={(e) => handleProjectChange('floors', e.target.value)} />
      </div>

      <div style={{ marginTop: '1rem' }}>
        <h2>Quote Items</h2>
        {quoteItems.map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input
              placeholder="Description"
              value={item.description}
              onChange={(e) => handleItemChange(i, 'description', e.target.value)}
            />
            <input
              type="number"
              placeholder="Qty"
              value={item.qty}
              onChange={(e) => handleItemChange(i, 'qty', e.target.value)}
            />
            <input
              type="number"
              placeholder="Unit Price"
              value={item.unitPrice}
              onChange={(e) => handleItemChange(i, 'unitPrice', e.target.value)}
            />
            <button onClick={() => removeItem(i)}>Remove</button>
          </div>
        ))}
        <button onClick={addItem}>Add Item</button>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2>Vendor Quote Upload</h2>
        <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
          <option value="">-- Select Category --</option>
          <option value="Rooftop Units">Rooftop Units</option>
          <option value="Fans">Fans</option>
          <option value="Dryer Vents">Dryer Vents</option>
          <option value="Diffusers">Diffusers</option>
          <option value="Louvers">Louvers</option>
        </select>
        <input type="file" multiple onChange={handleQuoteUpload} />
      </div>

      <div style={{ marginTop: '1rem' }}>
        <button onClick={saveEstimate}>Save Estimate to Cloud</button>
        <button onClick={loadEstimates}>Load Saved</button>

        {savedEstimates.length > 0 && (
          <div>
            <h3>Saved Estimates</h3>
            {savedEstimates.map((est, i) => (
              <button key={i} onClick={() => loadEstimate(i)}>
                {est.project?.name || `Estimate ${i + 1}`}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: '1rem', fontWeight: 'bold' }}>
        Total Estimate: ${total.toFixed(2)}
      </div>
    </div>
  );
}
