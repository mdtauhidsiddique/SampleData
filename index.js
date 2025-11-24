const express = require('express');
const { MongoClient } = require('mongodb');
const axios = require('axios');
const cors = require('cors');

// MongoDB connection string - URL encode password to handle special characters
const password = encodeURIComponent('hemant$9719');
const uri = `mongodb+srv://yadavhemant9719_db_user:${password}@kashra.uz8dvcu.mongodb.net/?appName=kashra`;

// Create a new MongoClient instance with connection options
const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000
});

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 8080;

// CORS middleware - allow requests from React app
app.use(cors({
  origin: '*', // React app origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Middleware to parse JSON bodies with increased size limit
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// GET API endpoint
app.get('/api/data', async (req, res) => {
  try {
    // Example: Fetch data from MongoDB
    const db = client.db('khashra');
    const collection = db.collection('items');
    const items = await collection.find({}).toArray();
    
    res.json({
      success: true,
      message: 'Data retrieved successfully',
      data: items
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching data',
      error: error.message
    });
  }
});

// POST API endpoint
app.post('/api/data', async (req, res) => {
  try {
    const { name, description } = req.body;
    
    // Validate input
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Name is required'
      });
    }
    
    // Example: Insert data into MongoDB
    const db = client.db('khashra');
    const collection = db.collection('items');
    const result = await collection.insertOne({
      name,
      description: description || '',
      createdAt: new Date()
    });
    
    res.status(201).json({
      success: true,
      message: 'Data created successfully',
      data: {
        id: result.insertedId,
        name,
        description: description || ''
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error creating data',
      error: error.message
    });
  }
});

// API endpoint to fetch from external API and save to MongoDB
app.post('/api/fetch-and-save', async (req, res) => {
  try {
    const apiUrl = 'https://svamitva.up.gov.in/WS_AuthorityGeom/api/getGeom';
    
    // Fetch data from external API with proper configuration for large responses
    console.log('Fetching data from external API...');
    
    // Use https module directly to avoid axios buffer limitations
    const https = require('https');
    const { URL } = require('url');
    
    // Fetch using native https module to handle large responses
    const fetchData = () => {
      return new Promise((resolve, reject) => {
        const url = new URL(apiUrl);
        const options = {
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json'
          }
        };
        
        const req = https.request(options, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            try {
              const jsonData = JSON.parse(data);
              resolve(jsonData);
            } catch (parseError) {
              reject(new Error('Failed to parse API response as JSON: ' + parseError.message));
            }
          });
        });
        
        req.on('error', (error) => {
          reject(new Error('Request failed: ' + error.message));
        });
        
        req.setTimeout(120000, () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
        
        req.end();
      });
    };
    
    // Fetch and parse the data
    const apiData = await fetchData();
    
    console.log('Data fetched successfully, type:', apiData?.type || 'unknown');
    
    // Save to MongoDB
    const db = client.db('hemantkhashra');
    const collection = db.collection('khashradata');
    
    // Prepare document to save - handle FeatureCollection specially
    const documentToSave = {
      type: apiData.type || 'unknown',
      name: apiData.name || null,
      crs: apiData.crs || null,
      fetchedAt: new Date(),
      sourceUrl: apiUrl
    };
    
    // If it's a FeatureCollection, save features count and handle features
    if (apiData.type === 'FeatureCollection' && apiData.features) {
      const totalFeatures = apiData.features.length;
      documentToSave.featuresCount = totalFeatures;
      console.log(`Total features received: ${totalFeatures}`);
      
      // Estimate size by checking a sample of features instead of stringifying everything
      // This avoids buffer overflow errors
      const sampleSize = Math.min(10, totalFeatures);
      const sampleFeatures = apiData.features.slice(0, sampleSize);
      const sampleSizeBytes = JSON.stringify(sampleFeatures).length;
      const estimatedSizePerFeature = sampleSizeBytes / sampleSize;
      const estimatedTotalSize = estimatedSizePerFeature * totalFeatures;
      const maxSize = 15 * 1024 * 1024; // 15MB (leave buffer for MongoDB 16MB limit)
      
      console.log(`Estimated total size: ${(estimatedTotalSize / 1024 / 1024).toFixed(2)} MB`);
      
      if (estimatedTotalSize < maxSize) {
        // Even if it fits, save only first 100 features as requested
        console.log('Saving first 100 features (as per requirement)');
        const featuresToSave = apiData.features.slice(0, 100);
        documentToSave.features = featuresToSave;
        documentToSave.note = `Saved first 100 out of ${totalFeatures} features`;
      } else {
        // For very large data, save first 100 features
        console.log('Response too large, saving first 100 features');
        const featuresToSave = apiData.features.slice(0, 100); // Save first 100 features
        documentToSave.features = featuresToSave;
        documentToSave.note = `Full data too large, saved first 100 out of ${totalFeatures} features`;
        console.log(`Saved ${featuresToSave.length} features to database`);
      }
    } else {
      // For non-FeatureCollection, try to save full data
      const estimatedSize = JSON.stringify(apiData).length;
      if (estimatedSize < 15 * 1024 * 1024) {
        documentToSave.fullData = apiData;
      } else {
        documentToSave.data = apiData;
        documentToSave.note = 'Data saved but may be truncated';
      }
    }
    
    // Insert the API response into MongoDB
    const result = await collection.insertOne(documentToSave);
    console.log('Data saved to MongoDB successfully, ID:', result.insertedId);
    
    res.json({
      success: true,
      message: 'Data fetched from API and saved successfully',
      insertedId: result.insertedId,
      featuresCount: documentToSave.featuresCount || 0,
      savedAt: documentToSave.fetchedAt
    });
  } catch (error) {
    console.error('Error fetching or saving data:', error.message);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Error fetching or saving data',
      error: error.message
    });
  }
});

// GET endpoint to retrieve saved data from MongoDB
app.get('/api/khashra-data', async (req, res) => {
  try {
    const db = client.db('hemantkhashra');
    const collection = db.collection('khashradata');
    
    // Get query parameters
    const limit = parseInt(req.query.limit) || 10;
    const skip = parseInt(req.query.skip) || 0;
    const includeFullData = req.query.fullData === 'true';
    
    // Get total count
    const totalCount = await collection.countDocuments({});
    
    // Fetch data with pagination
    let data;
    if (includeFullData) {
      data = await collection.find({})
        .sort({ fetchedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
    } else {
      // Exclude fullData field to reduce response size
      data = await collection.find({})
        .project({ fullData: 0 })
        .sort({ fetchedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray();
    }
    
    res.json({
      success: true,
      message: 'Data retrieved successfully',
      count: data.length,
      totalCount: totalCount,
      skip: skip,
      limit: limit,
      data: data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching data',
      error: error.message
    });
  }
});

// Connect to MongoDB and start server
async function startServer() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    console.log('📍 Cluster: kashra.uz8dvcu.mongodb.net');
    
    // Connect to MongoDB
    await client.connect();
    
    // Test connection by accessing database
    const db = client.db('hemantkhashra');
    await db.admin().ping();
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ SUCCESSFULLY CONNECTED TO MONGODB!');
    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ Database: hemantkhashra');
    console.log('✅ Collection: khashradata');
    console.log('✅ Connection Status: Active');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    
    // Start Express server
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
      console.log(`📡 GET API: http://localhost:${PORT}/api/data`);
      console.log(`📡 POST API: http://localhost:${PORT}/api/data`);
      console.log(`📡 Fetch & Save API: http://localhost:${PORT}/api/fetch-and-save`);
      console.log(`📡 Get Khashra Data: http://localhost:${PORT}/api/khashra-data`);
    });
  } catch (error) {
    console.error('❌ Error starting server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

// Close MongoDB connection on app termination
process.on('SIGINT', async () => {
  await client.close();
  console.log('MongoDB connection closed');
  process.exit(0);
});

module.exports = { app, client };