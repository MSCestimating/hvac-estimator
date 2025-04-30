import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectItem } from "@/components/ui/select";
import jsPDF from "jspdf";
import {
  initializeApp
} from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs
} from "firebase/firestore";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const defaultCategories = [
  "Equipment",
  "Air Distribution",
  "Piping",
  "Ductwork",
  "Controls",
  "Consumables"
];

function HVACEstimator() {
  const [user, setUser] = useState(null);
  const [project, setProject] = useState({ name: "", location: "", squareFootage: "", floors: "" });
  const [quoteItems, setQuoteItems] = useState([{ category: "Equipment", description: "Rooftop Unit", qty: 1, unitPrice: 12000 }]);
  const [savedEstimates, setSavedEstimates] = useState([]);
  const [selectedEstimate, setSelectedEstimate] = useState(null);

  useEffect(() => {
    onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
  }, []);

  useEffect(() => {
    const fetchEstimates = async () => {
      const querySnapshot = await getDocs(collection(db, "estimates"));
      const estimates = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSavedEstimates(estimates);
    };
    fetchEstimates();
  }, []);

  const handleLogin = async () => {
    await signInWithPopup(auth, provider);
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const loadEstimate = (id) => {
    const selected = savedEstimates.find(e => e.id === id);
    if (selected) {
      setProject(selected.project);
      setQuoteItems(selected.quoteItems);
      setSelectedEstimate(id);
    }
  };

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
    alert("Estimate saved to Firebase!");
  };

  const handleItemChange = (index, field, value) => {
    const updatedItems = [...quoteItems];
    updatedItems[index][field] = field === "qty" || field === "unitPrice" ? Number(value) : value;
    setQuoteItems(updatedItems);
  };

  const addQuoteItem = () => {
    setQuoteItems([...quoteItems, { category: "Equipment", description: "", qty: 0, unitPrice: 0 }]);
  };

  const removeQuoteItem = (index) => {
    const updatedItems = quoteItems.filter((_, i) => i !== index);
    setQuoteItems(updatedItems);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const parsedItems = [
      { category: "Air Distribution", description: "Diffuser - parsed", qty: 10, unitPrice: 45 },
      { category: "Ductwork", description: "Duct - parsed", qty: 500, unitPrice: 3.5 }
    ];
    const updatedItems = [...quoteItems, ...parsedItems];
    setQuoteItems(updatedItems);
  };

  const calculateTotals = () => {
    const materialTotal = quoteItems.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
    const laborTotal = 0;
    const subtotal = materialTotal + laborTotal;
    const markup = 0.15 * subtotal;
    const total = subtotal + markup;
    return { materialTotal, laborTotal, subtotal, markup, total };
  };

  const totals = calculateTotals();

  const exportProposalPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("HVAC Project Estimate", 20, 20);
    doc.setFontSize(11);
    doc.text(`Project: ${project.name}`, 20, 30);
    doc.text(`Location: ${project.location}`, 20, 36);
    doc.text(`Square Footage: ${project.squareFootage}`, 20, 42);
    doc.text(`Floors: ${project.floors}`, 20, 48);
    doc.text("\nQuote Line Items:", 20, 58);

    quoteItems.forEach((item, i) => {
      doc.text(
        `${item.category} - ${item.description} | Qty: ${item.qty} | Unit: $${item.unitPrice} | Total: $${(item.qty * item.unitPrice).toFixed(2)}`,
        20,
        64 + i * 6
      );
    });

    const yOffset = 70 + quoteItems.length * 6;
    doc.text(`Material Total: $${totals.materialTotal.toFixed(2)}`, 20, yOffset);
    doc.text(`Labor Total: $${totals.laborTotal.toFixed(2)}`, 20, yOffset + 6);
    doc.text(`Subtotal: $${totals.subtotal.toFixed(2)}`, 20, yOffset + 12);
    doc.text(`Markup (15%): $${totals.markup.toFixed(2)}`, 20, yOffset + 18);
    doc.setFontSize(12);
    doc.text(`Total: $${totals.total.toFixed(2)}`, 20, yOffset + 26);
    doc.save("HVAC_Estimate.pdf");
  };

  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="text-xl font-bold">{user ? `Welcome, ${user.displayName}` : "Not logged in"}</h2>
          <Button onClick={user ? handleLogout : handleLogin}>
            {user ? "Logout" : "Login with Google"}
          </Button>
          <Input placeholder="Project Name" value={project.name} onChange={e => setProject({ ...project, name: e.target.value })} />
          <Input placeholder="Location" value={project.location} onChange={e => setProject({ ...project, location: e.target.value })} />
          <Input placeholder="Square Footage" value={project.squareFootage} onChange={e => setProject({ ...project, squareFootage: e.target.value })} />
          <Input placeholder="Floors" value={project.floors} onChange={e => setProject({ ...project, floors: e.target.value })} />
          <Input type="file" onChange={handleFileUpload} />
          <Button onClick={saveEstimate}>Save to Cloud</Button>
          <Select onValueChange={loadEstimate}>
            {savedEstimates.map(est => (
              <SelectItem key={est.id} value={est.id}>{est.project.name}</SelectItem>
            ))}
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="text-xl font-bold">Quote Line Items</h2>
          {quoteItems.map((item, index) => (
            <div key={index} className="grid grid-cols-6 gap-2 items-center">
              <Select value={item.category} onValueChange={(val) => handleItemChange(index, "category", val)}>
                {defaultCategories.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </Select>
              <Input placeholder="Description" value={item.description} onChange={(e) => handleItemChange(index, "description", e.target.value)} />
              <Input type="number" placeholder="Qty" value={item.qty} onChange={(e) => handleItemChange(index, "qty", e.target.value)} />
              <Input type="number" placeholder="Unit Price" value={item.unitPrice} onChange={(e) => handleItemChange(index, "unitPrice", e.target.value)} />
              <div className="col-span-1">${(item.qty * item.unitPrice).toFixed(2)}</div>
              <Button onClick={() => removeQuoteItem(index)}>Remove</Button>
            </div>
          ))}
          <Button onClick={addQuoteItem}>Add Item</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="text-xl font-bold">Quote Summary</h2>
          <div>Material Total: ${totals.materialTotal.toFixed(2)}</div>
          <div>Labor Total: ${totals.laborTotal.toFixed(2)}</div>
          <div>Subtotal: ${totals.subtotal.toFixed(2)}</div>
          <div>Markup (15%): ${totals.markup.toFixed(2)}</div>
          <div className="font-bold">Total: ${totals.total.toFixed(2)}</div>
          <Button onClick={exportProposalPDF}>Export Proposal</Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default HVACEstimator;
