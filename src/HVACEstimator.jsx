import React, { useState } from 'react';

export default function HVACEstimator() {
  const [project, setProject] = useState({
    name: '',
    location: '',
    squareFootage: '',
    floors: ''
  });

  const [quoteItems, setQuoteItems] = useState([
    { description: 'Rooftop Unit', qty: 1, unitPrice: 12000 }
  ]);

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

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>HVAC Estimator</h1>

      <div style={{ marginBottom: '1rem' }}>
        <h2>Project Info</h2>
        <input placeholder="Name" value={project.name} onChange={(e) => handleProjectChange('name', e.target.value)} />
        <input placeholder="Location" value={project.location} onChange={(e) => handleProjectChange('location', e.target.value)} />
        <input placeholder="Square Footage" value={project.squareFootage} onChange={(e) => handleProjectChange('squareFootage', e.target.value)} />
        <input placeholder="Floors" value={project.floors} onChange={(e) => handleProjectChange('floors', e.target.value)} />
      </div>

      <div>
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

      <div style={{ marginTop: '1rem', fontWeight: 'bold' }}>
        Total Estimate: ${total.toFixed(2)}
      </div>
    </div>
  );
}


