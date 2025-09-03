```javascript
// ### YOUR FIREBASE CONFIG OBJECT IS PASTED HERE ###
const firebaseConfig = {
  apiKey: "AIzaSyAroc-0TvFXDvsVcvQ_ghlhyMQarVwVlB8",
  authDomain: "my-pos-laundry.firebaseapp.com",
  projectId: "my-pos-laundry",
  storageBucket: "my-pos-laundry.appspot.com",
  messagingSenderId: "40820558255",
  appId: "1:40820558255:web:e856b842bea93ef528475a",
  measurementId: "G-MQ4T2ZC4W4"
};

// ### NEW ### Initialize Firebase and Firestore
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
// ### NEW ### Enable Firestore offline persistence
db.enablePersistence().catch(err => {
    if (err.code == 'failed-precondition') {
        console.warn("Firestore persistence could not be enabled. This happens if multiple tabs are open.");
    } else if (err.code == 'unimplemented') {
        console.warn("The current browser does not support all of the features required to enable persistence.");
    }
});

// ### OPTIMIZATION ### Constants for collection names
const COLLECTIONS = {
    TRANSACTIONS: 'transactions',
    SERVICES: 'services',
    CUSTOMERS: 'customers',
    CONFIG: 'config',
    MACHINE_STATUS: 'machineStatus'
};


// --- Global State ---
let cart = [], shopSettings = {}, shopServices = [], shopCustomers = [];
let machineConfig = { numWashers: 2, numDryers: 2 };
let machineStatus = [];
let monthlyChartInstance = null;
let customerSearchTimeout; // For debouncing
let idleTimer; // For auto-lock
const TIMEZONE = "Asia/Manila";
let cancelPromoSend = false; // Flag for promo cancellation
let monthlyReportTransactionCache = [];

// --- BT --- Bluetooth Global State ---
let bluetoothDevice = null;
let bluetoothWriteCharacteristic = null;
let bluetoothSettings = { autoPrint: false };

// --- Element Cache ---
const allElements = {
    mainAppContainer: document.getElementById('main-app-container'),
    searchInputEl: document.getElementById('searchInput'), searchResultsEl: document.getElementById('searchResults'), nameEl: document.getElementById('name'), phoneEl: document.getElementById('phone'), paymentTypeEl: document.getElementById('paymentType'), totalEl: document.getElementById('total'), receiptSection: document.getElementById('receiptSection'), reviewDateEl: document.getElementById('reviewDate'), salesListEl: document.getElementById('salesList'), loadingIndicator: document.getElementById('loadingIndicator'),
    settingsPanel: document.getElementById('settings-panel'), settingShopName: document.getElementById('settingShopName'), settingShopAddress: document.getElementById('settingShopAddress'), settingShopPhone: document.getElementById('settingShopPhone'), settingQrUrl: document.getElementById('settingQrUrl'), serviceButtonsContainer: document.getElementById('service-buttons-container'), serviceLoader: document.getElementById('service-loader'), serviceListContainer: document.getElementById('service-list-container'), serviceFormTitle: document.getElementById('service-form-title'), serviceId: document.getElementById('service-id'), serviceLabel: document.getElementById('service-label'), servicePrice: document.getElementById('service-price'), serviceType: document.getElementById('service-type'),
    receiptShopName: document.getElementById('receiptShopName'), receiptShopAddress: document.getElementById('receiptShopAddress'), receiptShopPhone: document.getElementById('receiptShopPhone'), receiptQrCode: document.getElementById('receipt-qrcode'),
    currentPasswordEl: document.getElementById('currentPassword'), newPasswordEl: document.getElementById('newPassword'), confirmPasswordEl: document.getElementById('confirmPassword'),
    posView: document.getElementById('pos-view'), toPosBtn: document.getElementById('to-pos-btn'), findOrderSection: document.getElementById('find-order-section'),
    pickupView: document.getElementById('pickup-view'), toPickupBtn: document.getElementById('to-pickup-btn'),
    customerSearchResults: document.getElementById('customer-search-results'),
    headerTitle: document.getElementById('header-title'),
    pendingListContainer: document.getElementById('pending-list-container'),
    pickupSearchInput: document.getElementById('pickupSearchInput'),
    // BT Elements
    pickupConnectPrinterBtn: document.getElementById('pickup-connect-printer-btn'),
    pickupPrinterStatusText: document.getElementById('pickup-printer-status-text'),
    btPrintReceiptBtn: document.getElementById('bt-print-receipt-btn'),
    // Dashboard elements
    pickupDashboardSales: document.getElementById('pickup-dashboard-sales'),
    pickupDashboardForCollection: document.getElementById('pickup-dashboard-for-collection'),
    pickupDashboardTotalSales: document.getElementById('pickup-dashboard-pending-value'),
    loadingIndicatorText: document.getElementById('loadingIndicatorText'),
    // SMS elements
    settingSmsEnabled: document.getElementById('settingSmsEnabled'),
    smsConfigDetails: document.getElementById('sms-config-details'),
    settingSmsUsername: document.getElementById('settingSmsUsername'), // MODIFIED
    settingSmsPassword: document.getElementById('settingSmsPassword'), // MODIFIED
    smsTestPhoneNumber: document.getElementById('smsTestPhoneNumber'),
    settingSmsPickupMessageTemplate: document.getElementById('settingSmsPickupMessageTemplate'),
    customerPromoBtn: document.getElementById('customer-promo-btn'),
};

// --- Core App & UI Functions ---
const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true });

function showLoading(show, text = 'Processing...') {
    allElements.loadingIndicatorText.textContent = text;
    allElements.loadingIndicator.style.display = show ? 'flex' : 'none';
}

function closeReceipt() { allElements.receiptSection.classList.add('hidden'); allElements.findOrderSection.classList.remove('hidden'); }

function showView(viewId) {
    document.querySelectorAll('.main-view').forEach(view => view.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');

    if (viewId === 'pos-view') {
        allElements.toPosBtn.classList.add('hidden');
        allElements.toPickupBtn.classList.remove('hidden');
    } else if (viewId === 'pickup-view') {
        allElements.toPosBtn.classList.remove('hidden');
        allElements.toPickupBtn.classList.add('hidden');
    }
}

async function promptStaffLogin() {
    const passwordDoc = await db.collection(COLLECTIONS.CONFIG).doc('staffPassword').get();
    const correctPassword = passwordDoc.exists ? passwordDoc.data().value : 'admin';

    const { value: passwordGuess } = await Swal.fire({
        title: 'Staff Login',
        text: 'Please enter the staff password to continue.',
        input: 'password',
        inputPlaceholder: 'Enter your password',
        confirmButtonText: 'Login',
        allowOutsideClick: false,
        allowEscapeKey: false,
        inputValidator: (value) => {
            if (!value) {
                return 'Password is required!'
            }
        }
    });

    if (passwordGuess === correctPassword) {
        allElements.mainAppContainer.classList.remove('hidden');
        initializeApp();
    } else {
        await Swal.fire({
            icon: 'error',
            title: 'Access Denied',
            text: 'Incorrect password. Please try again.',
            allowOutsideClick: false,
            allowEscapeKey: false,
        });
        promptStaffLogin();
    }
}

async function initializeApp() {
    showLoading(true, 'Initializing app...');

    // Event Listeners
    allElements.nameEl.addEventListener('input', debouncedSearchCustomers);
    allElements.phoneEl.addEventListener('input', debouncedSearchCustomers);
    allElements.pickupSearchInput.addEventListener('input', () => renderPickupView());
    allElements.searchInputEl.addEventListener('keypress', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault(); 
            searchTransactions();
        }
    });

    // Setup default report dates
    allElements.reviewDateEl.value = dayjs().tz(TIMEZONE).format("YYYY-MM-DD");
    document.getElementById('reportStartDate').value = dayjs().tz(TIMEZONE).startOf('month').format('YYYY-MM-DD');
    document.getElementById('reportEndDate').value = dayjs().tz(TIMEZONE).endOf('month').format('YYYY-MM-DD');
    document.getElementById('reportMonth').value = dayjs().tz(TIMEZONE).format('YYYY-MM');

    showView('pos-view');

    await migrateDataToFirestore();

    setupRealtimeListeners();

    bluetoothSettings = await localforage.getItem('bluetooth_settings') || { autoPrint: false };
    updateBluetoothUI();

    showLoading(false);
    startIdleTimer();
}

function setupRealtimeListeners() {
    db.collection(COLLECTIONS.CONFIG).doc('shopSettings').onSnapshot(doc => {
        const defaultSettings = {
            name: "MAMA'S LOVE LAUNDRY", address: "123 Laundry St, Manila", phone: "0912-345-6789", qrUrl: "",
            smsEnabled: false,
            smsUsername: "", 
            smsPassword: "", 
            smsPickupMessageTemplate: "Hi [Customer Name], your Mama's Love Laundry order #[OR Number] is now ready for pickup! Thank you from [Shop Name]."
        };
        if (doc.exists) {
            shopSettings = { ...defaultSettings, ...doc.data() };
        } else {
            shopSettings = defaultSettings;
            db.collection(COLLECTIONS.CONFIG).doc('shopSettings').set(shopSettings);
        }
        renderShopInfo();
        renderSmsSettings();
        renderPickupDashboard();
    });

    allElements.serviceLoader.style.display = 'block';
    db.collection(COLLECTIONS.SERVICES).orderBy('label').onSnapshot(snapshot => {
        shopServices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (shopServices.length === 0) {
            const defaultServices = [
                { label: "Regular 8kg", price: 160, type: "fixed" },
                { label: "Comforter", price: 70, type: "per_kg" },
                { label: "Bedsheet", price: 70, type: "per_kg" }
            ];
            const batch = db.batch();
            defaultServices.forEach(service => {
                const docRef = db.collection(COLLECTIONS.SERVICES).doc();
                batch.set(docRef, service);
            });
            batch.commit();
        }
        renderServiceButtons();
        renderServiceList();
    });

    db.collection(COLLECTIONS.CUSTOMERS).onSnapshot(snapshot => {
        shopCustomers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    });

    db.collection(COLLECTIONS.CONFIG).doc('machineConfig').onSnapshot(doc => {
        if (doc.exists) {
            machineConfig = doc.data();
        } else {
            machineConfig = { numWashers: 2, numDryers: 2 };
            db.collection(COLLECTIONS.CONFIG).doc('machineConfig').set(machineConfig);
        }
        renderMachineSettings();
    });

    db.collection(COLLECTIONS.MACHINE_STATUS).orderBy('set').onSnapshot(snapshot => {
        machineStatus = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
         if (machineStatus.length !== (machineConfig.numWashers + machineConfig.numDryers)) {
            initializeMachineStatus();
        }
        renderOwnerMachineStatus();
    });

    db.collection(COLLECTIONS.TRANSACTIONS)
      .where('paymentType', 'in', ['collection', 'down_payment', 'paid'])
      .orderBy('time', 'desc')
      .limit(50)
      .onSnapshot(snapshot => {
        renderPickupView();
        renderPickupDashboard();
    });

    const todayStart = dayjs().tz(TIMEZONE).startOf('day').toISOString();
    const todayEnd = dayjs().tz(TIMEZONE).endOf('day').toISOString();
    db.collection(COLLECTIONS.TRANSACTIONS).where('time', '>=', todayStart).where('time', '<=', todayEnd)
      .onSnapshot(snapshot => {
         renderPickupDashboard();
      });
}


function runInBackground(task) {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(task);
    } else {
        setTimeout(task, 1);
    }
}

async function migrateDataToFirestore() {
    const migrationDone = await localforage.getItem('firestore_migration_v1_done');
    if (migrationDone) {
        console.log("Firestore migration already completed. Skipping.");
        return;
    }

    showLoading(true, "Migrating local data to cloud...");
    Toast.fire({icon: 'info', title: 'First-time setup: Syncing your data to the cloud...'});

    try {
        const batch = db.batch();

        const localCustomers = await localforage.getItem('shop_customers') || [];
        if (localCustomers.length > 0) {
            localCustomers.forEach(customer => {
                const docRef = db.collection(COLLECTIONS.CUSTOMERS).doc(String(customer.phone || customer.id));
                batch.set(docRef, customer);
            });
        }

        const localMachineConfig = await localforage.getItem('machine_config');
        if(localMachineConfig) batch.set(db.collection(COLLECTIONS.CONFIG).doc('machineConfig'), localMachineConfig);

        const localMachineStatus = await localforage.getItem('machine_status');
        if(localMachineStatus) {
            localMachineStatus.forEach(m => batch.set(db.collection(COLLECTIONS.MACHINE_STATUS).doc(m.id), m));
        }

        const keys = await localforage.keys();
        const dateKeys = keys.filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
        for (const key of dateKeys) {
            const dailyData = await localforage.getItem(key) || [];
            dailyData.forEach(tx => {
                const docRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(tx.orNumber);
                batch.set(docRef, {
                    ...tx,
                    smsSent: tx.smsSent || false,
                    dashboardFinished: (tx.paymentType === 'paid' && !shopSettings.smsEnabled) || false
                }, { merge: true });
            });
        }

        const localOrCounter = await localforage.getItem('global_or_counter');
        if(localOrCounter) batch.set(db.collection(COLLECTIONS.CONFIG).doc('orCounter'), { value: localOrCounter });

        const localPassword = await localforage.getItem('app_password');
        if(localPassword) batch.set(db.collection(COLLECTIONS.CONFIG).doc('appPassword'), { value: localPassword });

        await batch.commit();
        await localforage.setItem('firestore_migration_v1_done', true);
        showLoading(false);
        Swal.fire('Migration Complete!', 'Your data has been successfully synced to the cloud. All your devices are now connected.', 'success');
    } catch (error) {
        showLoading(false);
        console.error("Firestore migration failed:", error);
        Swal.fire('Migration Failed', `Could not sync data to the cloud. Please check your internet connection and Firebase setup. Error: ${error.message}`, 'error');
    }
}

function processBatches(array, processItem, onComplete) {
    let index = 0;
    async function doStep() {
        if (index >= array.length) {
            if (onComplete) onComplete();
            return;
        }
        await processItem(array[index]);
        index++;
        setTimeout(doStep, 0);
    }
    doStep();
}

async function renderPickupDashboard() {
    document.getElementById('dashboard-date').textContent = dayjs().tz(TIMEZONE).format('dddd, MMMM D, YYYY');

    const totalCollectedToday = await getTotalCollectedToday();
    allElements.pickupDashboardSales.textContent = `₱${totalCollectedToday.toFixed(2)}`;

    const todayStart = dayjs().tz(TIMEZONE).startOf('day').toDate();
    const todayEnd = dayjs().tz(TIMEZONE).endOf('day').toDate();
    const todaySnapshot = await db.collection(COLLECTIONS.TRANSACTIONS)
                                .where('time', '>=', todayStart.toISOString())
                                .where('time', '<=', todayEnd.toISOString())
                                .get();
    const totalSalesToday = todaySnapshot.docs.reduce((sum, doc) => sum + doc.data().total, 0);
    allElements.pickupDashboardTotalSales.textContent = `₱${totalSalesToday.toFixed(2)}`;

    const pendingSnapshot = await db.collection(COLLECTIONS.TRANSACTIONS).where('balanceDue', '>', 0).get();
    const forCollectionCount = pendingSnapshot.size;
    const totalValueForCollection = pendingSnapshot.docs.reduce((sum, doc) => sum + doc.data().balanceDue, 0);
    allElements.pickupDashboardForCollection.textContent = `₱${totalValueForCollection.toFixed(2)} (${forCollectionCount} orders)`;

    allElements.customerPromoBtn.style.display = shopSettings.smsEnabled ? 'flex' : 'none';
}

async function getTotalCollectedToday() {
    let collectedSum = 0;
    const todayStart = dayjs().tz(TIMEZONE).startOf('day').toDate();
    const todayEnd = dayjs().tz(TIMEZONE).endOf('day').toDate();

    const snapshot = await db.collection(COLLECTIONS.TRANSACTIONS)
                           .where('paymentTimestamp', '>=', todayStart.toISOString())
                           .where('paymentTimestamp', '<=', todayEnd.toISOString())
                           .get();

    snapshot.docs.forEach(doc => {
        const tx = doc.data();
        if (tx.balancePaidAmount) { 
             collectedSum += tx.balancePaidAmount;
        } else if (tx.paymentType === 'down_payment') { 
             collectedSum += tx.amountPaid;
        } else if (tx.paymentType === 'paid') { 
             collectedSum += tx.total; 
        }
    });

    return collectedSum;
}


function closeSettingsPanel() { allElements.settingsPanel.classList.remove('open'); }

function showSettingsTab(tabName) {
    document.querySelectorAll('.settings-tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.settings-tab-button').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-content-${tabName}`).classList.remove('hidden');
    document.getElementById(`tab-button-${tabName}`).classList.add('active');
    if (tabName === 'machines') {
        renderOwnerMachineStatus();
    } else if (tabName === 'config') {
        renderSmsSettings();
    }
}

async function openSettingsWithPassword() {
    const { value: passwordGuess } = await Swal.fire({
        title: 'Enter Owner Password',
        input: 'password',
        inputPlaceholder: 'Enter your password',
        inputAttributes: { autocapitalize: 'off', autocorrect: 'off' },
        showCancelButton: true,
        confirmButtonText: 'Unlock',
        confirmButtonColor: '#3b82f6'
    });
    if (passwordGuess) {
        const passwordDoc = await db.collection(COLLECTIONS.CONFIG).doc('appPassword').get();
        const correctPassword = passwordDoc.exists ? passwordDoc.data().value : 'root';
        if (passwordGuess === correctPassword) {
            allElements.settingsPanel.classList.add('open');
            allElements.currentPasswordEl.value = '';
            allElements.newPasswordEl.value = '';
            allElements.confirmPasswordEl.value = '';
            document.getElementById('newStaffPassword').value = '';
            document.getElementById('confirmStaffPassword').value = '';
            updatePasswordStrength();
            showSettingsTab('reports');
        } else {
            Swal.fire({ icon: 'error', title: 'Access Denied', text: 'Incorrect password.' });
        }
    }
}

function updatePasswordStrength() {
    const password = allElements.newPasswordEl.value;
    const indicator = document.getElementById('password-strength-indicator');
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.match(/[a-z]/) && password.match(/[A-Z]/)) strength++;
    if (password.match(/[0-9]/)) strength++;
    if (password.match(/[^a-zA-Z0-9]/)) strength++;

    indicator.className = '';
    if (password.length > 0) {
        if (strength <= 2) indicator.classList.add('strength-weak');
        else if (strength === 3) indicator.classList.add('strength-medium');
        else indicator.classList.add('strength-strong');
    }
}

function startIdleTimer() {
    const idleTimeout = 15 * 60 * 1000;
    const resetTimer = () => {
        clearTimeout(idleTimer);
        if (allElements.settingsPanel.classList.contains('open')) {
            idleTimer = setTimeout(() => {
                closeSettingsPanel();
                Swal.fire({
                    title: 'Session Locked',
                    text: 'You have been inactive. Please enter your password to continue.',
                    icon: 'warning',
                    allowOutsideClick: false,
                });
            }, idleTimeout);
        }
    };
    window.addEventListener('mousemove', resetTimer, true);
    window.addEventListener('keypress', resetTimer, true);
    window.addEventListener('scroll', resetTimer, true);
    resetTimer();
}


async function savePassword() {
    const currentPassword = allElements.currentPasswordEl.value, newPassword = allElements.newPasswordEl.value, confirmPassword = allElements.confirmPasswordEl.value;
    if (!currentPassword || !newPassword || !confirmPassword) return Swal.fire('Error', 'Please fill all owner password fields.', 'error');

    const passwordDoc = await db.collection(COLLECTIONS.CONFIG).doc('appPassword').get();
    const correctPassword = passwordDoc.exists ? passwordDoc.data().value : 'root';

    if (currentPassword !== correctPassword) return Swal.fire('Error', 'Current owner password is not correct.', 'error');
    if (newPassword.length < 8) return Swal.fire('Error', 'New owner password must be at least 8 characters long.', 'error');
    if (newPassword !== confirmPassword) return Swal.fire('Error', 'New owner passwords do not match.', 'error');

    await db.collection(COLLECTIONS.CONFIG).doc('appPassword').set({ value: newPassword });
    Toast.fire({ icon: 'success', title: 'Owner password changed successfully!' });
}

async function saveStaffPassword() {
    const newPassword = document.getElementById('newStaffPassword').value;
    const confirmPassword = document.getElementById('confirmStaffPassword').value;

    if (!newPassword || !confirmPassword) return Swal.fire('Error', 'Please fill all staff password fields.', 'error');
    if (newPassword.length < 4) return Swal.fire('Error', 'New staff password must be at least 4 characters long.', 'error');
    if (newPassword !== confirmPassword) return Swal.fire('Error', 'New staff passwords do not match.', 'error');

    await db.collection(COLLECTIONS.CONFIG).doc('staffPassword').set({ value: newPassword });
    Toast.fire({ icon: 'success', title: 'Staff password changed successfully!' });
    document.getElementById('newStaffPassword').value = '';
    document.getElementById('confirmStaffPassword').value = '';
}

function renderShopInfo() {
    allElements.headerTitle.textContent = shopSettings.name;
    allElements.receiptShopName.textContent = shopSettings.name;
    allElements.receiptShopAddress.textContent = shopSettings.address;
    allElements.receiptShopPhone.textContent = shopSettings.phone;
    allElements.settingShopName.value = shopSettings.name;
    allElements.settingShopAddress.value = shopSettings.address;
    allElements.settingShopPhone.value = shopSettings.phone;
    allElements.settingQrUrl.value = shopSettings.qrUrl || '';
    document.title = `${shopSettings.name} POS`;
}

async function saveShopInfo() {
    const newShopSettings = {
        name: allElements.settingShopName.value,
        address: allElements.settingShopAddress.value,
        phone: allElements.settingShopPhone.value,
        qrUrl: allElements.settingQrUrl.value
    };
    await db.collection(COLLECTIONS.CONFIG).doc('shopSettings').update(newShopSettings);
    Toast.fire({ icon: 'success', title: 'Shop info saved!' });
}

function renderSmsSettings() {
    allElements.settingSmsEnabled.checked = shopSettings.smsEnabled;
    allElements.settingSmsUsername.value = shopSettings.smsUsername || '';
    allElements.settingSmsPassword.value = shopSettings.smsPassword || '';
    allElements.settingSmsPickupMessageTemplate.value = shopSettings.smsPickupMessageTemplate || '';
    toggleSmsSettings(false);
}

async function saveSmsSettings() {
    const newSmsSettings = {
        smsEnabled: allElements.settingSmsEnabled.checked,
        smsUsername: allElements.settingSmsUsername.value.trim(),
        smsPassword: allElements.settingSmsPassword.value.trim(),
        smsPickupMessageTemplate: allElements.settingSmsPickupMessageTemplate.value.trim()
    };
    await db.collection(COLLECTIONS.CONFIG).doc('shopSettings').update(newSmsSettings);
    Toast.fire({ icon: 'success', title: 'SMS settings saved!' });
}

function toggleSmsSettings(save = true) {
    const isEnabled = allElements.settingSmsEnabled.checked;
    allElements.smsConfigDetails.style.display = isEnabled ? 'block' : 'none';
    if (save) {
        saveSmsSettings();
    }
}

function renderServiceButtons() {
    const c = allElements.serviceButtonsContainer;
    c.innerHTML = '';
    allElements.serviceLoader.style.display = 'none';
    const fS = shopServices.filter(s => s.type === 'fixed'), pS = shopServices.filter(s => s.type === 'per_kg');

    if (fS.length > 0) {
        const fC = document.createElement('div');
        fC.className = 'grid grid-cols-2 gap-3 mb-2';
        fC.innerHTML = '<label class="block font-semibold col-span-2">Fixed Price Services:</label>';
        fS.forEach(s => {
            const b = document.createElement('button');
            b.className = 'bg-blue-500 text-white p-3 rounded hover:bg-blue-600 transition flex flex-col items-center justify-center';
            b.innerHTML = `<span class="font-semibold">${s.label}</span><span class="text-xs">₱${s.price}</span>`;
            b.onclick = function() { addToCart(s.label, s.price, this); };
            fC.appendChild(b);
        });
        c.appendChild(fC);
    }

    if (pS.length > 0) {
        const pC = document.createElement('div');
        pC.className = 'mt-4 pt-4 border-t space-y-3';
        pC.innerHTML = '<label class="block font-semibold">Per-KG Services:</label>';
        pS.forEach(s => {
            const d = document.createElement('div');
            d.innerHTML = `<label class="block font-medium">${s.label} (₱${s.price}/kg):</label><div class="flex items-center gap-2 mt-1"><input id="weight-input-${s.id}" type="number" step="0.1" placeholder="Enter weight in kg" class="border p-2 w-full" /><button onclick="addPerKgItemFromInput('${s.id}', '${s.label.replace(/'/g, "\\'")}', ${s.price}, this)" class="bg-orange-500 text-white px-4 py-2 rounded hover:bg-orange-600 transition whitespace-nowrap">Add</button></div>`;
            pC.appendChild(d);
        });
        c.appendChild(pC);
    }
}

function renderServiceList() {
    allElements.serviceListContainer.innerHTML = '';
    shopServices.forEach(s => {
        const d = document.createElement('div');
        d.className = 'flex justify-between items-center p-2 border rounded';
        d.innerHTML = `<div><span class="font-semibold">${s.label}</span><span class="text-sm text-gray-600">- ₱${s.price} ${s.type === 'per_kg' ? '/kg' : ''}</span></div><div class="space-x-2"><button onclick="editService('${s.id}')" class="text-blue-500 hover:underline text-xs">Edit</button><button onclick="deleteService('${s.id}')" class="text-red-500 hover:underline text-xs">Delete</button></div>`;
        allElements.serviceListContainer.appendChild(d);
    });
}

function clearServiceForm() {
    allElements.serviceFormTitle.textContent = "Add New Service";
    Object.assign(allElements.serviceId, { value: '' });
    Object.assign(allElements.serviceLabel, { value: '', readOnly: false });
    Object.assign(allElements.servicePrice, { value: '', readOnly: false });
    Object.assign(allElements.serviceType, { value: 'fixed', readOnly: false });
}

async function saveService() {
    const id = allElements.serviceId.value;
    const label = allElements.serviceLabel.value;
    const price = parseFloat(allElements.servicePrice.value);
    const type = allElements.serviceType.value;
    if (!label || isNaN(price)) return Swal.fire('Invalid Input', 'Please enter a valid label and price.', 'error');

    const serviceData = { label, price, type };
    showLoading(true, 'Saving...');

    try {
        if (id) {
            await db.collection(COLLECTIONS.SERVICES).doc(id).update(serviceData);
        } else {
            await db.collection(COLLECTIONS.SERVICES).add(serviceData);
        }
        clearServiceForm();
        Toast.fire({ icon: 'success', title: 'Service saved!' });
    } catch (error) {
        console.error("Error saving service:", error);
        Swal.fire('Error', 'Could not save the service.', 'error');
    } finally {
        showLoading(false);
    }
}

function editService(id) {
    const s = shopServices.find(s => s.id == id);
    allElements.serviceFormTitle.textContent = "Edit Service";
    allElements.serviceId.value = s.id;
    allElements.serviceLabel.value = s.label;
    allElements.servicePrice.value = s.price;
    allElements.serviceType.value = s.type;
}

async function deleteService(id) {
    const r = await Swal.fire({ title: 'Are you sure?', text: "You won't be able to revert this!", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Yes, delete it!' });
    if (r.isConfirmed) {
        showLoading(true, 'Deleting...');
        try {
            await db.collection(COLLECTIONS.SERVICES).doc(id).delete();
            clearServiceForm();
            Swal.fire('Deleted!', 'The service has been deleted.', 'success');
        } catch (error) {
            console.error("Error deleting service:", error);
            Swal.fire('Error', 'Could not delete the service.', 'error');
        } finally {
            showLoading(false);
        }
    }
}

function renderMachineSettings() { document.getElementById('settingNumWashers').value = machineConfig.numWashers; document.getElementById('settingNumDryers').value = machineConfig.numDryers; }

async function initializeMachineStatus() {
    const batch = db.batch();
    const newStatus = [];
    for (let i = 1; i <= machineConfig.numWashers; i++) { newStatus.push({ id: `W${i}`, type: 'Washer', set: i, cycleCount: 0, isActive: true }); }
    for (let i = 1; i <= machineConfig.numDryers; i++) { newStatus.push({ id: `D${i}`, type: 'Dryer', set: i, cycleCount: 0, isActive: true }); }

    const currentStatusSnapshot = await db.collection(COLLECTIONS.MACHINE_STATUS).get();
    currentStatusSnapshot.docs.forEach(doc => batch.delete(doc.ref));

    newStatus.forEach(m => {
        const docRef = db.collection(COLLECTIONS.MACHINE_STATUS).doc(m.id);
        batch.set(docRef, m);
    });
    await batch.commit();
}

async function toggleSetStatus(setId) {
    const washerRef = db.collection(COLLECTIONS.MACHINE_STATUS).doc(`W${setId}`);
    const dryerRef = db.collection(COLLECTIONS.MACHINE_STATUS).doc(`D${setId}`);
    const washer = machineStatus.find(m => m.id === `W${setId}`);

    if (washer) {
        const isCurrentlyActive = washer.isActive;
        const batch = db.batch();
        batch.update(washerRef, { isActive: !isCurrentlyActive });
        batch.update(dryerRef, { isActive: !isCurrentlyActive });
        await batch.commit();
    }
}

function getMachineManagerHTML(isEmployeeView = false) {
    let managerHTML = `<div id="${isEmployeeView ? 'employee-machine-manager' : 'owner-machine-manager'}" class="space-y-4">`;
    for(let i = 1; i <= machineConfig.numWashers; i++) {
        const washer = machineStatus.find(m => m.id === `W${i}`);
        const dryer = machineStatus.find(m => m.id === `D${i}`);
        if (!washer || !dryer) continue;

        managerHTML += `
            <div class="p-3 border rounded ${washer.isActive ? 'bg-white' : 'bg-gray-100 opacity-70'}">
                <div class="flex justify-between items-center mb-2">
                    <span class="font-bold text-lg text-gray-700">Set ${i}</span>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" onchange="toggleSetStatus(${i})" ${washer.isActive ? 'checked' : ''} class="sr-only peer">
                        <div class="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                    </label>
                </div>
                <div class="text-center">
                    <p class="text-xs font-semibold ${washer.isActive ? 'text-green-600' : 'text-red-600'}">${washer.isActive ? 'Active' : 'Inactive'}</p>
                </div>
                <div class="mt-2 grid grid-cols-2 gap-2 text-center text-sm">
                    <div><p class="font-semibold">${washer.id}</p><p>${washer.cycleCount} cycles</p></div>
                    <div><p class="font-semibold">${dryer.id}</p><p>${dryer.cycleCount} cycles</p></div>
                </div>
            </div>`;
    }
    managerHTML += `</div>`;
    return managerHTML;
}
async function openMachineStatusManager() {
    await Swal.fire({
        title: 'Manage Active Machine Sets',
        html: getMachineManagerHTML(true),
        width: '90%',
        maxWidth: '500px',
        showConfirmButton: true,
        confirmButtonText: 'Done',
    });
}
function renderOwnerMachineStatus() { document.getElementById('owner-machine-status-container').innerHTML = getMachineManagerHTML(false); }

async function saveMachineSettings() {
    const nW = parseInt(document.getElementById('settingNumWashers').value);
    const nD = parseInt(document.getElementById('settingNumDryers').value);
    if (isNaN(nW) || isNaN(nD) || nW <= 0 || nW !== nD) {
        return Swal.fire('Error', 'Please enter a valid, equal number of Washers and Dryers.', 'error');
    }

    const r = await Swal.fire({
        title: 'Confirm Reset',
        text: "Updating machine counts will reset all cycle counts and statuses. Are you sure?",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, update and reset!'
    });

    if (r.isConfirmed) {
        machineConfig = { numWashers: nW, numDryers: nD };
        await db.collection(COLLECTIONS.CONFIG).doc('machineConfig').set(machineConfig);
        await initializeMachineStatus();
        Toast.fire({ icon: 'success', title: 'Machine settings saved and counts reset!' });
    }
}

function toggleMachineReport() { const c = document.getElementById('machine-usage-report-container'); c.classList.toggle('hidden'); if(!c.classList.contains('hidden')) renderMachineUsageReport(); }
function renderMachineUsageReport() { const l = document.getElementById('machine-usage-list'); l.innerHTML = ''; if (machineStatus.length === 0) { l.innerHTML = `<p class="text-center text-gray-500">No machines configured.</p>`; return; } machineStatus.filter(m => m.type==='Washer').sort((a,b) => b.cycleCount - a.cycleCount).forEach(w => { const d = machineStatus.find(m => m.id === `D${w.set}`); l.innerHTML += `<div class="flex justify-between p-2 border-b"><span><span class="font-bold">Set ${w.set}</span> (W${w.set}/D${d.set})</span> <span class="font-semibold">${w.cycleCount.toLocaleString()} cycles</span></div>`; }); }

async function confirmResetAllCycleCounts() {
    const r = await Swal.fire({
        title: 'Reset ALL Cycle Counts?',
        text: 'This action is permanent and cannot be undone!',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: 'Yes, Reset All'
    });
    if (r.isConfirmed) {
        await initializeMachineStatus();
        Toast.fire({ icon: 'success', title: 'All cycle counts have been reset to zero.' });
    }
}

function debouncedSearchCustomers() {
    clearTimeout(customerSearchTimeout);
    customerSearchTimeout = setTimeout(searchCustomers, 300);
}

function searchCustomers() {
    const nameTerm = allElements.nameEl.value.toLowerCase();
    const phoneTerm = allElements.phoneEl.value.toLowerCase();
    allElements.customerSearchResults.innerHTML = '';
    if (!nameTerm && !phoneTerm) { allElements.customerSearchResults.classList.add('hidden'); return; }
    const matches = shopCustomers.filter(c => (c.name && c.name.toLowerCase().includes(nameTerm)) && (c.phone && c.phone.toLowerCase().includes(phoneTerm)) ).slice(0, 5);
    if (matches.length > 0) {
        allElements.customerSearchResults.classList.remove('hidden');
        matches.forEach(c => {
            const item = document.createElement('div');
            item.className = 'p-2 hover:bg-gray-100 cursor-pointer';
            item.textContent = `${c.name} - ${c.phone}`;
            item.onclick = () => selectCustomer(c.name, c.phone);
            allElements.customerSearchResults.appendChild(item);
        });
    } else { allElements.customerSearchResults.classList.add('hidden'); }
}

function selectCustomer(name, phone) { allElements.nameEl.value = name; allElements.phoneEl.value = phone; allElements.customerSearchResults.innerHTML = ''; allElements.customerSearchResults.classList.add('hidden'); }
function addToCart(label, price, button) { cart.push({ label, price }); renderCart(); if (button) { const oT = button.innerHTML, oC = button.className; button.innerHTML = `<svg class="inline-block w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Added!`; button.className = oC.replace(/bg-(blue|orange)-500/, 'bg-green-500').replace(/hover:bg-(blue|orange)-600/, ''); button.disabled = true; setTimeout(() => { button.innerHTML = oT; button.className = oC; button.disabled = false; }, 1200); } }

function addPerKgItemFromInput(id, label, pricePerKg, button) {
    const wE = document.getElementById(`weight-input-${id}`), w = parseFloat(wE.value);
    if (isNaN(w) || w <= 0) return Swal.fire('Invalid Weight', 'Please enter a valid weight.', 'warning');
    addToCart(`${label} (${w}kg)`, w * pricePerKg, button);
    wE.value = '';
}

function renderCart() {
    const cE = document.getElementById('cart');
    cE.innerHTML = '';
    let t = 0;
    cart.forEach((i, idx) => { t += i.price; const d = document.createElement('div'); d.className = 'flex justify-between items-center py-1 border-b'; d.innerHTML = `<span>${i.label}</span><div class="flex items-center"><span>₱${i.price.toFixed(2)}</span><button onclick="removeItem(${idx})" class="text-red-500 ml-2 font-bold">&times;</button></div>`; cE.appendChild(d); });
    allElements.totalEl.textContent = t.toFixed(2);
}
function removeItem(index) { cart.splice(index, 1); renderCart(); }

function clearForm() {
    allElements.nameEl.value = '';
    allElements.phoneEl.value = '';
    document.getElementById('orderNotes').value = '';
    cart = [];
    renderCart();
    allElements.paymentTypeEl.value = 'collection';
    const sr = document.getElementById('customer-search-results');
    sr.innerHTML = '';
    sr.classList.add('hidden');
    shopServices.forEach(s => { const i = document.getElementById(`weight-input-${s.id}`); if (i) i.value = ''; });
}

async function confirmClearForm() { if (cart.length > 0 || allElements.nameEl.value || allElements.phoneEl.value) { const r = await Swal.fire({ title: 'Clear Form?', text: 'All unsaved items will be lost.', icon: 'question', showCancelButton: true, confirmButtonText: 'Yes, Clear' }); if (r.isConfirmed) clearForm(); } }

async function submitOrder() {
    const name = allElements.nameEl.value.trim();
    const phone = allElements.phoneEl.value.trim().replace(/\D/g, '');
    const paymentType = allElements.paymentTypeEl.value;
    const notes = document.getElementById('orderNotes').value.trim();
    const total = cart.reduce((s, i) => s + i.price, 0);

    if (!name || cart.length === 0) {
        return Swal.fire('Incomplete Form', 'Customer Name and at least one item are required.', 'warning');
    }

    let cH = `<div class="text-left space-y-2 my-4"><p><strong>Customer:</strong> ${name} (${phone || 'N/A'})</p>${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}<hr class="my-2"><ul class="space-y-1">${cart.map(i => `<li class="flex justify-between"><span>${i.label}</span><span>₱${i.price.toFixed(2)}</span></li>`).join('')}</ul><hr class="my-2"><p class="flex justify-between font-bold text-lg"><span>Total:</span><span>₱${total.toFixed(2)}</span></p></div>`;

    const r = await Swal.fire({
        title: 'Confirm Order Details',
        html: cH,
        icon: 'info',
        showCancelButton: true,
        confirmButtonColor: '#3b82f6',
        confirmButtonText: 'Confirm & Proceed'
    });

    if (r.isConfirmed) {
        let amountPaid = 0;
        let balanceDue = total;
        let change = 0;
        let dashboardFinished = false;

        if (paymentType === 'paid') {
            const amountPaidInput = await getAmountReceived(total, total, 'Amount Received');
            if (amountPaidInput === null) return;
            amountPaid = amountPaidInput;
            balanceDue = 0;
            change = amountPaidInput - total;
            if (!shopSettings.smsEnabled) {
                dashboardFinished = true;
            }
        } else if (paymentType === 'down_payment') {
            const downPaymentAmountInput = await getAmountReceived(0.01, total, 'Down Payment Amount');
            if (downPaymentAmountInput === null) return;
            amountPaid = downPaymentAmountInput;
            balanceDue = Math.max(0, total - downPaymentAmountInput);
            change = Math.max(0, downPaymentAmountInput - total);
        }

        const orderData = { name, phone, cart: [...cart], total, paymentType, amountPaid, change, notes, balanceDue, smsSent: false, dashboardFinished: dashboardFinished };

        clearForm();
        Toast.fire({icon: 'success', title: 'Order submitted!'});

        processAndSaveOrder(orderData).catch(err => {
            console.error("Failed to save order:", err);
            Swal.fire('Save Failed', 'Could not save the order to the database. Please check your internet connection and try again.', 'error');
        });
    }
}

async function processAndSaveOrder(orderData) {
    const { name, phone, cart, total, paymentType, amountPaid, notes, balanceDue, change, smsSent, dashboardFinished } = orderData;

    const time = dayjs().tz(TIMEZONE).toISOString();
    const orCounterRef = db.collection(COLLECTIONS.CONFIG).doc('orCounter');

    const orNumber = await db.runTransaction(async (transaction) => {
        const orCounterDoc = await transaction.get(orCounterRef);
        const newOrValue = (orCounterDoc.exists ? orCounterDoc.data().value : 0) + 1;
        transaction.set(orCounterRef, { value: newOrValue });
        return String(newOrValue).padStart(6, '0');
    });

    const finalTransactionData = {
        ...orderData,
        orNumber: orNumber,
        time: time,
        paymentTimestamp: paymentType !== 'collection' ? time : null,
        _searchableKeywords: [ name.toLowerCase(), phone, orNumber ]
    };

    const batch = db.batch();
    const transactionRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(orNumber);
    batch.set(transactionRef, finalTransactionData);

    if (phone) {
        const customerRef = db.collection(COLLECTIONS.CUSTOMERS).doc(phone);
        batch.set(customerRef, { name, phone }, { merge: true });
    }

    const numLoads = cart.length;
    if (numLoads > 0) {
        let activeWashers = [...machineStatus].filter(m => m.type === 'Washer' && m.isActive);
        if (activeWashers.length > 0) {
            for (let i = 0; i < numLoads; i++) {
                activeWashers.sort((a, b) => a.cycleCount - b.cycleCount);
                const chosenWasher = activeWashers[0];
                chosenWasher.cycleCount++;
                batch.update(db.collection(COLLECTIONS.MACHINE_STATUS).doc(chosenWasher.id), { cycleCount: firebase.firestore.FieldValue.increment(1) });
                batch.update(db.collection(COLLECTIONS.MACHINE_STATUS).doc(`D${chosenWasher.set}`), { cycleCount: firebase.firestore.FieldValue.increment(1) });
            }
        }
    }

    await batch.commit();
    showReceipt(finalTransactionData);
}

async function saveBluetoothSettings() {
    const isChecked = document.getElementById('swal-auto-print-toggle').checked;
    bluetoothSettings.autoPrint = isChecked;
    await localforage.setItem('bluetooth_settings', bluetoothSettings);
    Toast.fire({ icon: 'success', title: `Auto-Print ${isChecked ? 'Enabled' : 'Disabled'}` });
}

class EscPosEncoder {
    constructor() { this._buffer = []; this.encoder = new TextEncoder(); }
    _add(data) { this._buffer.push(...data); }
    initialize() { this._add([0x1B, 0x40]); return this; }
    text(str) { this._add(this.encoder.encode(str)); return this; }
    newline(n = 1) { for (let i = 0; i < n; i++) this._add([0x0A]); return this; }
    align(alignment) { const val = { left: 0, center: 1, right: 2 }[alignment]; this._add([0x1B, 0x61, val]); return this; }
    bold(on) { this._add([0x1B, 0x45, on ? 1 : 0]); return this; }
    cut() { this._add([0x1D, 0x56, 1]); return this; }
    qrcode(data, size = 4) {
        const qr = qrcode(0, 'M');
        qr.addData(data);
        qr.make();
        const moduleCount = qr.getModuleCount();
        const store = [0x1d, 0x28, 0x6b, 0x00, 0x00, 0x00, 0x00, 0x31, 0x41, 0x32, 0x00];
        store[3] = (moduleCount + 3) & 0xff;
        store[4] = ((moduleCount + 3) >> 8) & 0xff;
        this._add([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]);
        this._add([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 49]);
        this._add(store);
        this._add(this.encoder.encode(data));
        this._add([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 48]);
        return this;
    }
    getBuffer() { return new Uint8Array(this._buffer); }
}


function updateBluetoothUI(status = 'disconnected', deviceName = '') {
    const button = allElements.pickupConnectPrinterBtn;
    const text = allElements.pickupPrinterStatusText;

    button.classList.remove('disconnected', 'connecting', 'connected');

    switch(status) {
        case 'connected':
            button.classList.add('connected');
            text.textContent = `Printer: ${deviceName}`;
            break;
        case 'connecting':
            button.classList.add('connecting');
            text.textContent = 'Connecting...';
            break;
        case 'disconnected':
        default:
            button.classList.add('disconnected');
            text.textContent = 'Connect Printer';
            bluetoothDevice = null;
            bluetoothWriteCharacteristic = null;
            break;
    }
}

function onBluetoothDisconnected() {
    Toast.fire({ icon: 'warning', title: 'Printer Connection Lost' });
    updateBluetoothUI('disconnected');
}

async function openPrinterManagerPopup() {
    const isConnected = bluetoothDevice && bluetoothDevice.gatt.connected;

    await Swal.fire({
        title: 'Printer Connection',
        html: `
            <div id="popup-bt-status" class="mb-4 p-2 rounded text-center font-semibold ${isConnected ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}">
                Status: ${isConnected ? `Connected to ${bluetoothDevice.name}` : 'Not Connected'}
            </div>
            <label for="swal-auto-print-toggle" class="mt-4 flex justify-between items-center cursor-pointer">
                <span class="font-medium text-gray-700">Auto-Print Receipts</span>
                <div class="relative">
                    <input type="checkbox" id="swal-auto-print-toggle" class="sr-only" onchange="saveBluetoothSettings()" ${bluetoothSettings.autoPrint ? 'checked' : ''}>
                    <div class="block bg-gray-600 w-14 h-8 rounded-full"></div>
                    <div class="dot absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition"></div>
                </div>
            </label>
        `,
        showConfirmButton: true,
        confirmButtonText: isConnected ? 'Test Print' : 'Connect to Printer',
        showDenyButton: isConnected,
        denyButtonText: 'Disconnect',
        showCancelButton: true,
        cancelButtonText: 'Close',
        didOpen: () => {
            const confirmButton = Swal.getConfirmButton();
            const denyButton = Swal.getDenyButton();

            confirmButton.onclick = async () => {
                if (bluetoothDevice && bluetoothDevice.gatt.connected) {
                    await testBluetoothPrint();
                } else {
                    Swal.close();
                    await connectBluetoothPrinter();
                }
            };
            if (denyButton) {
                denyButton.onclick = async () => {
                    Swal.close();
                    await disconnectBluetoothPrinter();
                };
            }
        }
    });
}

async function connectBluetoothPrinter() {
    let device;
    try {
        Swal.fire({
            title: 'Searching for Printers...',
            text: 'Please select your thermal printer from the list.',
            showConfirmButton: false,
            allowOutsideClick: false,
            willOpen: () => Swal.showLoading()
        });

        device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2']
        });

        Swal.update({ title: `Connecting to ${device.name}...`, text: 'Please wait.' });
        await connectToDevice(device);
        Swal.close();

    } catch(error) {
        Swal.close();
        if (error.name === 'NotFoundError') {
            Toast.fire({ icon: 'info', title: 'Device selection cancelled.' });
        } else if (error.name === 'NotSupportedError') {
            Swal.fire('Bluetooth Not Supported', 'Web Bluetooth is not available on this browser. Please use Google Chrome or Microsoft Edge.', 'error');
        } else {
            console.error("Bluetooth connection error:", error);
            Swal.fire('Connection Failed', `An error occurred: ${error.message}`, 'error');
        }
        updateBluetoothUI('disconnected');
    }
}

async function connectToDevice(device) {
    console.log('Attempting to connect to:', device.name);
    updateBluetoothUI('connecting');

    let gattServer;
    try {
        device.addEventListener('gattserverdisconnected', onBluetoothDisconnected);

        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
            console.warn('Connection attempt timed out.');
        }, 15000);

        gattServer = await device.gatt.connect();
        clearTimeout(timeout);

        Swal.update({ text: 'Discovering services...' });
        const services = await gattServer.getPrimaryServices();

        let characteristic = null;
        const knownServiceUUIDs = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'];

        for (const serviceUUID of knownServiceUUIDs) {
            try {
                const service = await gattServer.getPrimaryService(serviceUUID);
                const characteristics = await service.getCharacteristics();
                for (const char of characteristics) {
                    if (char.properties.write || char.properties.writeWithoutResponse) {
                        characteristic = char;
                        break;
                    }
                }
            } catch (e) { /* Service not found, continue */ }
            if (characteristic) break;
        }

        if (!characteristic) {
            for (const service of services) {
                const characteristics = await service.getCharacteristics();
                for (const char of characteristics) {
                     if (char.properties.write || char.properties.writeWithoutResponse) {
                        characteristic = char;
                        break;
                    }
                }
                if(characteristic) break;
            }
        }

        if (!characteristic) {
            throw new Error("Could not find a writable characteristic on this printer. It might be incompatible.");
        }

        bluetoothDevice = device;
        bluetoothWriteCharacteristic = characteristic;
        Toast.fire({ icon: 'success', title: `Connected to ${device.name}` });
        updateBluetoothUI('connected', device.name);

    } catch (error) {
        console.error("connectToDevice failed:", error);
        if (device && device.gatt && device.gatt.connected) {
            device.gatt.disconnect();
        }
        throw error;
    }
}

async function disconnectBluetoothPrinter() {
    if (bluetoothDevice && bluetoothDevice.gatt.connected) {
        bluetoothDevice.gatt.disconnect();
        Toast.fire({ icon: 'info', title: 'Printer disconnected.' });
    } else {
         Toast.fire({ icon: 'info', title: 'Printer was already disconnected.' });
    }
    updateBluetoothUI('disconnected');
}

async function sendDataToBluetoothPrinter(data) {
    if (!bluetoothWriteCharacteristic) {
        throw new Error('No printer connected or characteristic not found.');
    }
    const chunkSize = 100;
    const delay = 50;

    try {
        for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.slice(i, i + chunkSize);
            await bluetoothWriteCharacteristic.writeValueWithoutResponse(chunk);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    } catch (error) {
        console.error("Failed to send data chunk:", error);
        throw new Error(`Failed to send data to printer: ${error.message}`);
    }
}

async function testBluetoothPrint() {
    showLoading(true, 'Sending test print...');
    try {
        const encoder = new EscPosEncoder();
        const data = encoder.initialize()
            .align('center')
            .bold(true).text('Printer Test\n').bold(false)
            .text('Connection Successful!\n')
            .text(`${shopSettings.name}\n`)
            .text(`${dayjs().format('YYYY-MM-DD HH:mm')}\n`)
            .newline(2)
            .cut()
            .getBuffer();
        await sendDataToBluetoothPrinter(data);
        Toast.fire({ icon: 'success', title: 'Test print sent!' });
    } catch (error) {
        Swal.fire('Test Print Failed', error.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function printBluetoothReceipt(tx) {
    if (!tx) return Swal.fire('Error', 'No transaction data to print.', 'error');
    if (!bluetoothWriteCharacteristic) return Swal.fire('Printer Error', 'Bluetooth printer is not connected. Please connect first.', 'error');

    showLoading(true, 'Sending to printer...');
    try {
        const encoder = new EscPosEncoder();
        const itemWidth = 20, priceWidth = 10;

        encoder.initialize()
               .align('center').bold(true).text(shopSettings.name).newline()
               .bold(false).text(shopSettings.address).newline()
               .text(shopSettings.phone).newline(1)
               .text('------------------------------').newline()
               .bold(true).text('OFFICIAL RECEIPT').newline(1)
               .bold(false).align('left')
               .text(`OR #: ${tx.orNumber}`).newline()
               .text(`Date: ${dayjs(tx.time).format('MM/DD/YY h:mm A')}`).newline()
               .text(`Cust: ${tx.name} (${tx.phone || 'N/A'})`).newline(1)
               .text('------------------------------').newline();

        tx.cart.forEach(item => {
            const label = item.label.length > itemWidth ? item.label.substring(0, itemWidth - 1) + '.' : item.label;
            const price = `P${item.price.toFixed(2)}`;
            encoder.text(`${label.padEnd(itemWidth)}${price.padStart(priceWidth)}`).newline();
        });

        encoder.text('------------------------------').newline()
               .bold(true).text(`${'TOTAL'.padEnd(itemWidth)}${`P${tx.total.toFixed(2)}`.padStart(priceWidth)}`).newline();

        let paymentStatusLine = '';

        if (tx.paymentType === 'paid' && !tx.balancePaidAmount) { 
            paymentStatusLine = '*** FULLY PAID ***';
            encoder.align('left')
                   .text(`${'CASH'.padEnd(itemWidth)}${`P${tx.amountPaid.toFixed(2)}`.padStart(priceWidth)}`).newline()
                   .text(`${'CHANGE'.padEnd(itemWidth)}${`P${tx.change.toFixed(2)}`.padStart(priceWidth)}`).newline();
        } else if (tx.paymentType === 'down_payment') {
            paymentStatusLine = '*** DOWN PAYMENT ***';
            encoder.align('left')
                   .text(`${'PAID (DP)'.padEnd(itemWidth)}${`P${tx.amountPaid.toFixed(2)}`.padStart(priceWidth)}`).newline()
                   .text(`${'BALANCE DUE'.padEnd(itemWidth)}${`P${tx.balanceDue.toFixed(2)}`.padStart(priceWidth)}`).newline();
            if (tx.change > 0) {
                encoder.text(`${'CHANGE'.padEnd(itemWidth)}${`P${tx.change.toFixed(2)}`.padStart(priceWidth)}`).newline();
            }
        } else if (tx.balancePaidAmount) { 
            paymentStatusLine = '*** BALANCE PAID ***';
            encoder.align('left')
                   .text(`${'BALANCE PAID'.padEnd(itemWidth)}${`P${tx.balancePaidAmount.toFixed(2)}`.padStart(priceWidth)}`).newline();
            if (tx.balanceDue > 0) {
                encoder.text(`${'REMAINING'.padEnd(itemWidth)}${`P${tx.balanceDue.toFixed(2)}`.padStart(priceWidth)}`).newline();
            }
            if (tx.change > 0) {
                encoder.text(`${'CHANGE'.padEnd(itemWidth)}${`P${tx.change.toFixed(2)}`.padStart(priceWidth)}`).newline();
            }
            encoder.text(`${'TOTAL COLLECTED'.padEnd(itemWidth)}${`P${(tx.amountPaid).toFixed(2)}`.padStart(priceWidth)}`).newline();
        }
         else { 
            paymentStatusLine = '*** FOR COLLECTION ***';
        }

        encoder.align('center').bold(true).text(paymentStatusLine).newline().bold(false);

        if (tx.notes) {
            encoder.align('left').bold(true).text(`Notes: ${tx.notes}`).newline();
        }

        encoder.newline(1).align('center').text('Thank you!');

        if (shopSettings.qrUrl) {
            encoder.newline(1).qrcode(shopSettings.qrUrl, 4);
        }

        encoder.newline(2).cut();

        await sendDataToBluetoothPrinter(encoder.getBuffer());
        if (!bluetoothSettings.autoPrint) { Toast.fire({ icon: 'success', title: 'Receipt sent to printer!' }); }

    } catch (error) {
        console.error("Print failed:", error);
        Swal.fire('Print Failed', `Could not send receipt to printer. Please check the connection. <br><br><b>Error:</b> ${error.message}`, 'error');
        disconnectBluetoothPrinter();
    } finally {
        showLoading(false);
    }
}
function showReceipt(tx) {
    document.getElementById('receipt-details-compact').innerHTML = `
        OR #: ${tx.orNumber}<br>
        Date: ${dayjs(tx.time).format('MM/DD/YY h:mm A')}<br>
        Cust: ${tx.name} (${tx.phone || 'N/A'})
    `;
    const itemWidth = 20; const priceWidth = 10;
    let itemsHtml = tx.cart.map(item => {
        const label = item.label.length > itemWidth ? item.label.substring(0, itemWidth - 1) + '.' : item.label;
        const price = `₱${item.price.toFixed(2)}`;
        return `<div>${label.padEnd(itemWidth)}${price.padStart(priceWidth)}</div>`;
    }).join('');
    document.getElementById('receipt-items-compact').innerHTML = itemsHtml;
    let summaryHtml = `<div>${'TOTAL'.padEnd(itemWidth)}${`₱${tx.total.toFixed(2)}`.padStart(priceWidth)}</div>`;
    let paymentStatusDisplay = '';
    if (tx.paymentType === 'paid' && !tx.balancePaidAmount) {
        paymentStatusDisplay = 'FULLY PAID';
        summaryHtml += `<div>${'CASH'.padEnd(itemWidth)}${`₱${tx.amountPaid.toFixed(2)}`.padStart(priceWidth)}</div>`;
        summaryHtml += `<div>${'CHANGE'.padEnd(itemWidth)}${`₱${tx.change.toFixed(2)}`.padStart(priceWidth)}</div>`;
    } else if (tx.paymentType === 'down_payment') {
        paymentStatusDisplay = 'DOWN PAYMENT';
        summaryHtml += `<div>${'PAID (DP)'.padEnd(itemWidth)}${`₱${tx.amountPaid.toFixed(2)}`.padStart(priceWidth)}</div>`;
        summaryHtml += `<div>${'BALANCE DUE'.padEnd(itemWidth)}${`₱${tx.balanceDue.toFixed(2)}`.padStart(priceWidth)}</div>`;
        if (tx.change > 0) {
            summaryHtml += `<div>${'CHANGE'.padEnd(itemWidth)}${`₱${tx.change.toFixed(2)}`.padStart(priceWidth)}</div>`;
        }
    } else if (tx.paymentType === 'collection') {
        paymentStatusDisplay = 'FOR COLLECTION';
    } else if (tx.balancePaidAmount) {
        paymentStatusDisplay = 'BALANCE PAID';
        summaryHtml += `<div>${'BALANCE PAID'.padEnd(itemWidth)}${`₱${tx.balancePaidAmount.toFixed(2)}`.padStart(priceWidth)}</div>`;
        if (tx.balanceDue > 0) {
            summaryHtml += `<div>${'REMAINING'.padEnd(itemWidth)}${`₱${tx.balanceDue.toFixed(2)}`.padStart(priceWidth)}</div>`;
        }
        if (tx.change > 0) {
            summaryHtml += `<div>${'CHANGE'.padEnd(itemWidth)}${`₱${tx.change.toFixed(2)}`.padStart(priceWidth)}</div>`;
        }
        summaryHtml += `<div>${'TOTAL COLLECTED'.padEnd(itemWidth)}${`₱${(tx.amountPaid).toFixed(2)}`.padStart(priceWidth)}</div>`;
    }
    summaryHtml += `<div class="font-bold">Payment Status: ${paymentStatusDisplay}</div>`;
    if (tx.notes) {
      summaryHtml += `<div class="font-bold">Notes: ${tx.notes}</div>`;
    }
    document.getElementById('receipt-summary-compact').innerHTML = summaryHtml;
    allElements.receiptQrCode.innerHTML = '';
    if (shopSettings.qrUrl) {
        try {
            const qr = qrcode(0, 'L');
            qr.addData(shopSettings.qrUrl);
            qr.make();
            allElements.receiptQrCode.innerHTML = qr.createImgTag(3, 4);
        } catch (e) { console.error("QR Code generation failed:", e); }
    }
    allElements.btPrintReceiptBtn.classList.toggle('hidden', !bluetoothWriteCharacteristic);
    allElements.btPrintReceiptBtn.onclick = () => printBluetoothReceipt(tx);
    if (bluetoothSettings.autoPrint && bluetoothWriteCharacteristic) {
        printBluetoothReceipt(tx);
    } else {
        allElements.findOrderSection.classList.add('hidden');
        allElements.receiptSection.classList.remove('hidden');
    }
}
async function getAmountReceived(minAmount, maxAmount, inputLabel = 'Amount Received') {
    return new Promise(resolve => {
        Swal.fire({
            title: `Total Due: ₱${maxAmount.toFixed(2)}`,
            input: 'number',
            inputLabel: inputLabel,
            inputPlaceholder: 'Enter amount',
            showCancelButton: true,
            confirmButtonText: 'Confirm Payment',
            html: `<div id="swal-change-display"></div>`,
            inputValidator: (value) => {
                const amount = parseFloat(value);
                if (isNaN(amount) || amount < minAmount) {
                    return `Amount must be greater than or equal to ₱${minAmount.toFixed(2)}.`;
                }
                if (inputLabel === 'Down Payment Amount' && amount > maxAmount) {
                     return `Down payment cannot exceed the total amount of ₱${maxAmount.toFixed(2)}.`;
                }
                return null;
            },
            didOpen: () => {
                const input = Swal.getInput();
                const changeDisplay = document.getElementById('swal-change-display');
                input.addEventListener('input', () => {
                    const amount = parseFloat(input.value);
                    if(isNaN(amount)) { changeDisplay.textContent = ''; return; }
                    if (inputLabel === 'Down Payment Amount') {
                        const balance = maxAmount - amount;
                        if (balance >= 0) {
                            changeDisplay.textContent = `Balance Due: ₱${balance.toFixed(2)}`;
                            changeDisplay.className = 'negative';
                        } else {
                            changeDisplay.textContent = `Change: ₱${Math.abs(balance).toFixed(2)}`;
                            changeDisplay.className = 'positive';
                        }
                    } else {
                        const change = amount - maxAmount;
                        if (change >= 0) {
                            changeDisplay.textContent = `Change: ₱${change.toFixed(2)}`;
                            changeDisplay.className = 'positive';
                        } else {
                            changeDisplay.textContent = `Short: ₱${Math.abs(change).toFixed(2)}`;
                            changeDisplay.className = 'negative';
                        }
                    }
                });
            }
        }).then(result => {
            if (result.isConfirmed) { resolve(parseFloat(result.value)); } else { resolve(null); }
        });
    });
}

// ### NEW: ADVANCED SEARCH FUNCTION ###
async function searchTransactions() {
    const term = allElements.searchInputEl.value.trim();
    if (!term) { 
        allElements.searchResultsEl.innerHTML = ''; 
        return; 
    }

    showLoading(true, `Searching for "${allElements.searchInputEl.value}"...`);
    allElements.searchResultsEl.innerHTML = '';

    try {
        let transactionDocs = [];
        // Priority 1: Check for a full, 6-digit OR number for a direct lookup.
        if (/^\d{6}$/.test(term)) {
            const doc = await db.collection(COLLECTIONS.TRANSACTIONS).doc(term).get();
            if (doc.exists) {
                transactionDocs.push(doc);
            }
        } 
        
        // Priority 2: If it's not a full OR number, perform a broader search on recent items.
        if (transactionDocs.length === 0) {
            const recentSnapshot = await db.collection(COLLECTIONS.TRANSACTIONS)
                                         .orderBy('time', 'desc')
                                         .limit(200) // Broaden the search pool for partial matches
                                         .get();
            transactionDocs = recentSnapshot.docs;
        }

        let allResults = transactionDocs.map(doc => ({ id: doc.id, ...doc.data() }));
        let matches = [];
        
        // If it was a full OR number, the result is the only match.
        if (/^\d{6}$/.test(term)) {
            matches = allResults;
        } else {
            // Otherwise, filter the broad results for partial matches.
            const lowerCaseTerm = term.toLowerCase();
            matches = allResults.filter(tx => {
                const nameMatch = tx.name.toLowerCase().includes(lowerCaseTerm);
                const phoneMatch = tx.phone && tx.phone.includes(lowerCaseTerm);
                const orMatch = tx.orNumber.includes(lowerCaseTerm);
                return nameMatch || phoneMatch || orMatch;
            });
        }

        if (matches.length > 0) {
             matches.sort((a, b) => new Date(b.time) - new Date(a.time));
             matches.forEach(tx => renderTransaction(tx, allElements.searchResultsEl, false));
        } else {
             allElements.searchResultsEl.innerHTML = '<p class="text-center text-gray-500 p-4">No matching orders found.</p>';
        }

    } catch (error) {
        console.error("Error during searchTransactions:", error);
        Swal.fire('Search Error', `An error occurred during search: ${error.message}`, 'error');
        allElements.searchResultsEl.innerHTML = '<p class="text-center text-red-500 p-4">An error occurred.</p>';
    } finally {
        showLoading(false);
    }
}


function clearSearch() {
    allElements.searchInputEl.value = '';
    allElements.searchResultsEl.innerHTML = '';
}

function renderTransaction(tx, container, allowEditing = true) {
    const card = document.createElement('div');
    let statusTag, statusTagColor, payButtonHtml = '', smsButtonHtml = '';
    let displayAmount;

    if (tx.balanceDue === undefined) { tx.balanceDue = Math.max(0, tx.total - (tx.amountPaid || 0)); }
    if (tx.smsSent === undefined) tx.smsSent = false;
    if (tx.dashboardFinished === undefined) tx.dashboardFinished = false;

    if (tx.paymentType === 'paid') {
        statusTag = 'Paid'; statusTagColor = 'bg-green-200 text-green-800'; displayAmount = tx.total.toFixed(2);
    } else if (tx.paymentType === 'down_payment') {
        statusTag = 'Down Payment'; statusTagColor = 'bg-blue-200 text-blue-800';
        displayAmount = `${tx.amountPaid.toFixed(2)} (Bal: ${tx.balanceDue.toFixed(2)})`;
        payButtonHtml = `<button onclick="markAsPaidAndGetAmount('${tx.orNumber}', ${tx.balanceDue}, 'balance_paid')" class="bg-blue-500 text-white px-3 py-1 rounded text-xs hover:bg-blue-600">Pay Balance</button>`;
    } else { 
        statusTag = 'For Collection'; statusTagColor = 'bg-yellow-200 text-yellow-800';
        displayAmount = tx.balanceDue.toFixed(2);
        payButtonHtml = `<button onclick="markAsPaidAndGetAmount('${tx.orNumber}', ${tx.total}, 'paid')" class="bg-blue-500 text-white px-3 py-1 rounded text-xs hover:bg-blue-600">Mark as Paid</button>`;
    }

    if (shopSettings.smsEnabled && tx.phone) {
         smsButtonHtml = tx.smsSent ? `<button disabled class="bg-gray-300 text-gray-700 px-3 py-1 rounded text-xs ml-2">SMS Sent</button>` : `<button onclick="sendPickupReadySms('${tx.orNumber}', '${tx.phone}', '${tx.name}')" class="bg-purple-500 text-white px-3 py-1 rounded text-xs hover:bg-purple-600 ml-2">Send SMS</button>`;
    }

    const editButtonHtml = allowEditing ? `<button onclick='editTransaction("${tx.orNumber}")' class="bg-yellow-500 text-white px-3 py-1 rounded text-xs hover:bg-yellow-600">Edit</button>` : '';

    card.className = 'p-3 bg-white border rounded shadow-sm mb-2';
    card.innerHTML = `
        <div class="flex justify-between items-start">
            <div>
                <p class="font-bold text-base">OR#: ${tx.orNumber}</p>
                <p>${tx.name} - ${tx.phone || 'N/A'}</p>
                <p class="text-xs text-gray-500">${dayjs(tx.time).format('MMM DD, YYYY - h:mm A')}</p>
            </div>
            <div class="flex flex-col items-end">
                <p class="font-bold text-lg text-blue-600">₱${displayAmount}</p>
                <span class="text-xs font-medium px-2 py-0.5 rounded-full ${statusTagColor} mt-1">${statusTag}</span>
            </div>
        </div>
        ${tx.notes ? `<p class="mt-2 text-xs italic text-gray-600"><strong>Notes:</strong> ${tx.notes}</p>` : ''}
        <div class="mt-2 text-xs">${tx.cart.map(i => i.label).join(', ')}</div>
        <div class="mt-2 pt-2 border-t flex justify-end gap-2">
            ${payButtonHtml} ${smsButtonHtml}
            ${editButtonHtml}
            <button onclick='showReceipt(${JSON.stringify(tx)})' class="bg-gray-200 px-3 py-1 rounded text-xs hover:bg-gray-300">View Receipt</button>
        </div>
    `;
    container.appendChild(card);
}

async function markAsPaidAndGetAmount(orNumber, amountDue, newPaymentType) {
    const inputLabel = (newPaymentType === 'balance_paid') ? 'Amount to Pay Balance' : 'Amount Received';
    const amountPaidInput = await getAmountReceived(amountDue, amountDue, inputLabel);
    if (amountPaidInput === null) return;

    showLoading(true);

    try {
        const change = amountPaidInput - amountDue;
        const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(orNumber);
        const currentDoc = await txRef.get();
        if (!currentDoc.exists) throw new Error(`Transaction ${orNumber} not found.`);
        const currentTransaction = currentDoc.data();

        let updatedData = {};
        if (newPaymentType === 'paid') {
            updatedData = {
                paymentType: 'paid', amountPaid: (currentTransaction.amountPaid || 0) + amountPaidInput, change: change,
                paymentTimestamp: dayjs().tz(TIMEZONE).toISOString(), balanceDue: 0
            };
            if (!shopSettings.smsEnabled) {
                updatedData.dashboardFinished = true;
            } else {
                updatedData.dashboardFinished = false;
            }

        } else if (newPaymentType === 'balance_paid') {
            updatedData = {
                paymentType: 'paid', amountPaid: (currentTransaction.amountPaid || 0) + amountPaidInput,
                balancePaidAmount: amountPaidInput, change: change,
                paymentTimestamp: dayjs().tz(TIMEZONE).toISOString(), balanceDue: 0
            };
             if (!shopSettings.smsEnabled) {
                updatedData.dashboardFinished = true;
            } else {
                updatedData.dashboardFinished = false;
            }
        }

        await txRef.update(updatedData);

        if (allElements.searchInputEl.value) { await searchTransactions(); }
        Toast.fire({ icon: 'success', title: `Order ${orNumber} marked as Paid!` });

    } catch (error) {
        console.error("Error marking as paid:", error);
        Swal.fire('Error', `Failed to mark order as paid: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

function searchAllOrdersFromPickup(searchTerm) {
    showView('pos-view');
    allElements.searchInputEl.value = searchTerm;
    searchTransactions(); 
    allElements.findOrderSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function renderPickupView() {
    const container = allElements.pendingListContainer;
    container.innerHTML = '<div class="inline-loader"></div>';
    const searchTerm = allElements.pickupSearchInput.value.toLowerCase();

    const pendingOrdersSnapshot = await db.collection(COLLECTIONS.TRANSACTIONS)
                                          .where('balanceDue', '>', 0)
                                          .get();
    let ordersWithBalanceDue = pendingOrdersSnapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));

    const paidAwaitingSmsSnapshot = await db.collection(COLLECTIONS.TRANSACTIONS)
                                           .where('paymentType', '==', 'paid')
                                           .where('smsSent', '==', false)
                                           .where('dashboardFinished', '==', false)
                                           .get();
    let paidAwaitingSmsOrders = paidAwaitingSmsSnapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));


    let allDashboardOrders = [...ordersWithBalanceDue, ...paidAwaitingSmsOrders];

    if (searchTerm) {
        allDashboardOrders = allDashboardOrders.filter(tx =>
            tx.name.toLowerCase().includes(searchTerm) ||
            (tx.phone && tx.phone.toLowerCase().includes(searchTerm)) ||
            tx.orNumber.toLowerCase().includes(searchTerm)
        );
    }

    container.innerHTML = '';

    if (allDashboardOrders.length === 0) {
        let messageHtml = '';
        if (searchTerm) {
            messageHtml = `
                <div class="text-center p-4 bg-white rounded-lg shadow-sm">
                    <p class="text-gray-600 mb-3 font-semibold">No PENDING orders match your filter.</p>
                    <button onclick="searchAllOrdersFromPickup('${searchTerm.replace(/'/g, "\\'")}')" class="bg-indigo-500 text-white px-4 py-2 rounded-md hover:bg-indigo-600 shadow-sm font-semibold">
                        Search All Historical Orders for "${searchTerm.replace(/'/g, "\\'")}"
                    </button>
                </div>
            `;
        } else {
            messageHtml = `<p class="text-center text-gray-500 p-4">No orders waiting for customer action.</p>`;
        }
        container.innerHTML = messageHtml;
        return;
    }

    allDashboardOrders.sort((a, b) => new Date(a.time) - new Date(b.time)).forEach(tx => renderPickupCard(tx, container));
}

function getColorForText(str) {
    if (!str) return 'text-gray-700';
    const colors = [ 'text-red-700', 'text-green-700', 'text-blue-700', 'text-indigo-700', 'text-purple-700', 'text-pink-700', 'text-teal-700', 'text-orange-800' ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) { hash = str.charCodeAt(i) + ((hash << 5) - hash); }
    return colors[Math.abs(hash % colors.length)];
}

function renderPickupCard(tx, container) {
    if (tx.dashboardFinished) {
        return;
    }

    const card = document.createElement('div');
    const timeObj = dayjs(tx.time);
    let displayTime, timeSuffix = ' ago';
    if (typeof timeObj.fromNow === 'function') { displayTime = timeObj.fromNow(true); }
    else { displayTime = timeObj.format('MMM DD, YYYY'); timeSuffix = ''; }

    let bgColor, statusTag, statusTagColor, totalDisplay, payButtonHtml = '', smsButtonHtml = '';
    let viewReceiptButtonHtml = ''; 
    const customerNameColor = getColorForText(tx.name);

    if (tx.balanceDue === undefined) tx.balanceDue = Math.max(0, tx.total - (tx.amountPaid || 0));
    if (tx.smsSent === undefined) tx.smsSent = false;
    if (tx.dashboardFinished === undefined) tx.dashboardFinished = false;

    if (tx.paymentType === 'down_payment') {
        bgColor = 'bg-blue-50 border-blue-200'; statusTag = 'Down Payment'; statusTagColor = 'bg-blue-200 text-blue-800';
        totalDisplay = `₱${tx.amountPaid.toFixed(2)} (Bal: ₱${tx.balanceDue.toFixed(2)})`;
        payButtonHtml = `<button onclick="markAsPaidAndGetAmount('${tx.orNumber}', ${tx.balanceDue}, 'balance_paid')" class="bg-blue-500 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-blue-600">Pay Balance</button>`;
    } else if (tx.paymentType === 'paid') {
        bgColor = 'bg-green-50 border-green-200'; statusTag = 'Fully Paid'; statusTagColor = 'bg-green-200 text-green-800';
        totalDisplay = `₱${tx.total.toFixed(2)}`;
        payButtonHtml = ''; 
        viewReceiptButtonHtml = `<button onclick='showReceipt(${JSON.stringify(tx)})' class="bg-gray-200 p-2 rounded hover:bg-gray-300" title="View Receipt">
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                </button>`;
    }
    else { 
        bgColor = 'bg-yellow-50 border-yellow-200'; statusTag = 'For Collection'; statusTagColor = 'bg-yellow-200 text-yellow-800';
        totalDisplay = `₱${tx.balanceDue.toFixed(2)}`;
        payButtonHtml = `<button onclick="markAsPaidAndGetAmount('${tx.orNumber}', ${tx.total}, 'paid')" class="bg-blue-500 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-blue-600">Mark as Paid</button>`;
    }

    if (shopSettings.smsEnabled && tx.phone) {
        smsButtonHtml = tx.smsSent ? `<button disabled class="bg-gray-300 text-gray-700 px-4 py-2 rounded text-sm ml-2">SMS Sent</button>` : `<button onclick="sendPickupReadySms('${tx.orNumber}', '${tx.phone}', '${tx.name}')" class="bg-purple-500 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-purple-600 ml-2">Send SMS</button>`;
    }

    card.className = `p-4 border rounded-lg shadow-sm ${bgColor}`;
    card.innerHTML = `
        <div class="flex flex-col md:flex-row justify-between gap-4">
            <div>
                <div class="flex items-baseline gap-2">
                    <p class="font-bold text-lg">OR# ${tx.orNumber}</p>
                    <span class="text-xs font-medium px-2 py-0.5 rounded-full ${statusTagColor}">${statusTag}</span>
                </div>
                <p class="text-base"><span class="font-bold text-lg ${customerNameColor}">${tx.name}</span> <span class="font-normal text-gray-600">(${tx.phone || 'No Phone'})</span></p>
                <p class="text-sm text-gray-500">Dropped off: ${displayTime}${timeSuffix}</p>
                ${tx.notes ? `<p class="mt-2 text-sm italic text-gray-700"><strong>Notes:</strong> ${tx.notes}</p>` : ''}
            </div>
            <div class="flex flex-col items-start md:items-end">
                <p class="font-bold text-2xl mb-2">${totalDisplay}</p>
                <div class="flex items-center gap-2 flex-wrap justify-end">
                    ${payButtonHtml} ${smsButtonHtml} ${viewReceiptButtonHtml}
                </div>
            </div>
        </div>`;
    container.appendChild(card);
}

async function generateEndOfDayReport() {
    showLoading(true);
    const totalCollectedToday = await getTotalCollectedToday();

    const todayStart = dayjs().tz(TIMEZONE).startOf('day').toDate();
    const todayEnd = dayjs().tz(TIMEZONE).endOf('day').toDate();
    const todaySnapshot = await db.collection(COLLECTIONS.TRANSACTIONS).where('time', '>=', todayStart.toISOString()).where('time', '<=', todayEnd.toISOString()).get();
    const totalSalesToday = todaySnapshot.docs.reduce((sum, doc) => sum + doc.data().total, 0);

    const pendingSnapshot = await db.collection(COLLECTIONS.TRANSACTIONS).where('balanceDue', '>', 0).get();
    const forCollectionCount = pendingSnapshot.size;
    const totalValueForCollection = pendingSnapshot.docs.reduce((sum, doc) => sum + doc.data().balanceDue, 0);

    const reportHtml = `
        <div class="text-left space-y-3">
            <p class="text-2xl font-bold">End of Day Report</p>
            <p class="text-sm text-gray-500">${dayjs().tz(TIMEZONE).format('MMMM D, YYYY')}</p><hr>
            <p class="flex justify-between"><span>Total Collected Revenue (Cash on Hand):</span> <span class="font-bold text-xl">₱${totalCollectedToday.toFixed(2)}</span></p>
            <p class="flex justify-between"><span>Total Sales (Orders Created Today):</span> <span class="font-bold text-xl">₱${totalSalesToday.toFixed(2)}</span></p><hr>
            <p class="flex justify-between"><span>Orders for Collection / Has Balance:</span> <span class="font-bold">${forCollectionCount} orders</span></p>
            <p class="flex justify-between"><span>Outstanding Balance Total:</span> <span class="font-bold text-xl">₱${totalValueForCollection.toFixed(2)}</span></p>
        </div>`;
    showLoading(false);
    Swal.fire({ title: 'Daily Summary', html: reportHtml, confirmButtonText: 'Great!' });
}

function toggleDailyReport() {
    const btn = document.getElementById('daily-report-btn'), list = document.getElementById('salesList');
    if (list.style.display === 'none') {
        generateDailyReport(); list.style.display = 'block'; btn.textContent = 'Hide Daily Details';
    } else {
        list.style.display = 'none'; btn.textContent = 'View Daily Details';
    }
}

async function generateDailyReport() {
    showLoading(true);
    const dateKey = allElements.reviewDateEl.value;
    const dayStart = dayjs(dateKey).startOf('day').toISOString();
    const dayEnd = dayjs(dateKey).endOf('day').toISOString();
    const snapshot = await db.collection(COLLECTIONS.TRANSACTIONS).where('time', '>=', dayStart).where('time', '<=', dayEnd).get();
    const dailyData = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));

    const container = allElements.salesListEl;
    container.innerHTML = '';
    if (dailyData.length === 0) {
        container.innerHTML = `<p class="text-center text-gray-500 p-4">No sales on ${dateKey}.</p>`;
        showLoading(false); return;
    }
    const total = dailyData.reduce((sum, tx) => sum + tx.total, 0);
    container.innerHTML = `<p class="font-bold text-lg p-2 bg-gray-100 rounded">Total for ${dateKey}: ₱${total.toFixed(2)}</p>`;
    dailyData.forEach(tx => renderTransaction(tx, container));
    showLoading(false);
}

async function generateExcelReport() {
    const startDateStr = document.getElementById('reportStartDate').value;
    const endDateStr = document.getElementById('reportEndDate').value;
    if (!startDateStr || !endDateStr) return Swal.fire('Missing Date', 'Please select a start and end date.', 'warning');

    showLoading(true, 'Generating Report...');
    try {
        const startDate = dayjs(startDateStr).startOf('day'), endDate = dayjs(endDateStr).endOf('day');
        const salesData = await getSalesDataForPeriod(startDate, endDate);
        if (salesData.length === 0) { showLoading(false); return Swal.fire('No Data', 'No sales data found for the selected period.', 'info'); }

        const detailedRows = [], serviceRevenue = {};
        salesData.forEach(tx => {
            tx.cart.forEach(item => {
                const baseLabel = item.label.split(' (')[0];
                if (!serviceRevenue[baseLabel]) serviceRevenue[baseLabel] = { revenue: 0, count: 0 };
                serviceRevenue[baseLabel].revenue += item.price;
                serviceRevenue[baseLabel].count++;
                detailedRows.push({ "OR #": tx.orNumber, "Date": tx.time, "Customer": tx.name, "Phone": tx.phone, "Item": item.label, "Price": item.price, "Order Total": tx.total, "Payment": tx.paymentType, "Paid (Total)": tx.amountPaid, "DP Amount": tx.paymentType==='down_payment' ? tx.amountPaid : 0, "Balance Paid": tx.balancePaidAmount||0, "Balance Due": tx.balanceDue||0, "Change": tx.change||0, "Pay Date": tx.paymentTimestamp||'N/A', "SMS Sent": tx.smsSent?'Yes':'No', "Notes": tx.notes||'' });
            });
        });

        const totalSales = salesData.reduce((s,tx)=>s+tx.total,0), collectedInPeriod = Object.values(await getCollectedDataForPeriod(startDate,endDate)).reduce((s,a)=>s+a,0);
        const summaryData = [
            { Metric: "Period", Value: `${startDateStr} to ${endDateStr}` },
            { Metric: "Total Sales Revenue", Value: `₱${totalSales.toFixed(2)}` },
            { Metric: "Total Collected (in period)", Value: `₱${collectedInPeriod.toFixed(2)}` },
            { Metric: "Total Orders", Value: salesData.length },
            {}, { Metric: "--- Service Breakdown ---" },
        ];
        Object.entries(serviceRevenue).sort((a,b)=>b[1].revenue-a[1].revenue).forEach(([l,d])=>{ summaryData.push({Metric:`${l} (Sales)`,Value:`₱${d.revenue.toFixed(2)}`}); summaryData.push({Metric:`${l} (Count)`,Value:d.count}); });

        const wb = XLSX.utils.book_new(), wsDetails = XLSX.utils.json_to_sheet(detailedRows), wsSummary = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, wsSummary, "Summary"); XLSX.utils.book_append_sheet(wb, wsDetails, "Detailed Sales");
        wsDetails["!cols"] = [ {wch:10}, {wch:18}, {wch:20}, {wch:15}, {wch:25}, {wch:10}, {wch:12}, {wch:12}, {wch:18}, {wch:18}, {wch:18}, {wch:12}, {wch:12}, {wch:18}, {wch:10}, {wch:30} ];
        wsSummary["!cols"] = [ {wch:40}, {wch:25} ];
        XLSX.writeFile(wb, `Laundry_Report_${startDateStr}_to_${endDateStr}.xlsx`);
        showLoading(false);
        Toast.fire({ icon: 'success', title: 'Report generated!' });
    } catch (error) { showLoading(false); console.error("Excel report failed:", error); Swal.fire('Error', 'Failed to generate report.', 'error'); }
}

async function generateNewMonthlyReport() {
    const reportMonthInput = document.getElementById('reportMonth');
    if (!reportMonthInput.value) {
        return Swal.fire('Error', 'Please select a month and year to generate a report.', 'warning');
    }
    
    const container = document.getElementById('monthly-report-output');
    showLoading(true, `Generating report for ${dayjs(reportMonthInput.value).format("MMMM YYYY")}...`);
    
    await generateMonthlyReport(reportMonthInput.value); 
    
    container.classList.remove('hidden');
    showLoading(false);
}

async function generateMonthlyReport(selectedMonth) { 
    monthlyReportTransactionCache = [];
    document.getElementById('monthly-report-search-input').value = ''; 

    const now = dayjs(selectedMonth).tz(TIMEZONE);
    const currentMonthStart = now.startOf('month');
    const currentMonthEnd = now.endOf('month');
    const prevMonthStart = now.subtract(1, 'month').startOf('month');
    const prevMonthEnd = now.subtract(1, 'month').endOf('month');
    const prevYearMonthStart = now.subtract(1, 'year').startOf('month');
    const prevYearMonthEnd = now.subtract(1, 'year').endOf('month');

    document.getElementById('monthly-report-title').textContent = `Monthly Report for ${now.format("MMMM YYYY")}`;

    const [currentMonthSales, prevMonthSales, prevYearMonthSales, collectedDataMap] = await Promise.all([
        getSalesDataForPeriod(currentMonthStart, currentMonthEnd),
        getSalesDataForPeriod(prevMonthStart, prevMonthEnd),
        getSalesDataForPeriod(prevYearMonthStart, prevYearMonthEnd),
        getCollectedDataForPeriod(currentMonthStart, currentMonthEnd)
    ]);

    monthlyReportTransactionCache = [...currentMonthSales]; 

    const totalCollected = Object.values(collectedDataMap).reduce((sum, val) => sum + val, 0);
    const currentTotalSales = currentMonthSales.reduce((s, t) => s + t.total, 0);
    const currentTotalOrders = currentMonthSales.length;
    const currentAvgSale = currentTotalOrders > 0 ? currentTotalSales / currentTotalOrders : 0;
    const netProfit = totalCollected - currentTotalSales;

    document.getElementById('monthlyTotalCollected').textContent = `₱${totalCollected.toFixed(2)}`;
    document.getElementById('monthlyTotalSales').textContent = `₱${currentTotalSales.toFixed(2)}`;
    document.getElementById('monthlyNet').textContent = `₱${netProfit.toFixed(2)}`;
    document.getElementById('monthlyNet').className = `text-2xl font-bold ${netProfit >= 0 ? 'text-green-900' : 'text-red-900'}`;
    document.getElementById('monthlyTotalOrders').textContent = currentTotalOrders.toLocaleString();
    document.getElementById('monthlyAvgSale').textContent = `₱${currentAvgSale.toFixed(2)}`;

    const prevMonthTotalSales = prevMonthSales.reduce((s, t) => s + t.total, 0);
    const prevYearMonthTotalSales = prevYearMonthSales.reduce((s, t) => s + t.total, 0);
    const renderComparison = (c, p) => {
        if (p === 0) return `<span class="text-gray-500">N/A (No prior data)</span>`;
        const diff = ((c - p) / p) * 100;
        return `<span class="${diff >= 0 ? 'text-green-600' : 'text-red-600'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)}%</span> vs ₱${p.toFixed(2)}`;
    };
    document.getElementById('vsPrevMonth').innerHTML = renderComparison(currentTotalSales, prevMonthTotalSales);
    document.getElementById('vsPrevYear').innerHTML = renderComparison(currentTotalSales, prevYearMonthTotalSales);

    const dayOfWeekSales = { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 }; 
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    currentMonthSales.forEach(tx => {
        const dayIndex = dayjs(tx.time).tz(TIMEZONE).day();
        dayOfWeekSales[dayIndex] += tx.total;
    });
    let busiestDayIndex = -1, quietestDayIndex = -1;
    let maxSales = -1, minSales = Infinity;
    for (let i = 0; i < 7; i++) {
        if (dayOfWeekSales[i] > maxSales) { maxSales = dayOfWeekSales[i]; busiestDayIndex = i; }
        if (dayOfWeekSales[i] < minSales) { minSales = dayOfWeekSales[i]; quietestDayIndex = i; }
    }
    document.getElementById('busiestDay').textContent = dayNames[busiestDayIndex];
    document.getElementById('quietestDay').textContent = dayNames[quietestDayIndex];

    const daysInMonth = now.daysInMonth();
    const dailySales = new Array(daysInMonth).fill(0);
    const chartLabels = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    currentMonthSales.forEach(tx => { dailySales[dayjs(tx.time).tz(TIMEZONE).date() - 1] += tx.total; });
    if (monthlyChartInstance) monthlyChartInstance.destroy();
    monthlyChartInstance = new Chart(document.getElementById('monthlySalesChart').getContext('2d'), {
        type: 'line',
        data: { labels: chartLabels, datasets: [{ label: 'Daily Sales (₱)', data: dailySales, borderColor: 'rgb(124,58,237)', backgroundColor: 'rgba(124,58,237,0.1)', tension: 0.1, fill: true }] },
        options: { scales: { y: { beginAtZero: true } } }
    });

    const serviceRevenue = {};
    currentMonthSales.forEach(tx => tx.cart.forEach(item => {
        const label = item.label.split(' (')[0];
        if (!serviceRevenue[label]) serviceRevenue[label] = { revenue: 0, count: 0 };
        serviceRevenue[label].revenue += item.price;
        serviceRevenue[label].count++;
    }));
    const topServices = Object.entries(serviceRevenue).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);
    const topServicesContainer = document.getElementById('top-services-list');
    topServicesContainer.innerHTML = topServices.length > 0 ? topServices.map(([label, data]) => {
        const percentage = currentTotalSales > 0 ? (data.revenue / currentTotalSales * 100).toFixed(1) : 0;
        return `<div class="p-2 bg-gray-50 rounded">
                    <div class="flex justify-between items-center font-semibold"><span>${label}</span><span>₱${data.revenue.toFixed(2)}</span></div>
                    <div class="text-xs text-gray-500 flex justify-between"><span>${data.count} orders</span><span>${percentage}% of Sales</span></div>
                </div>`;
    }).join('') : `<p class="text-center text-gray-500 p-2">No services sold this month.</p>`;

    const customerSpending = {};
    currentMonthSales.forEach(tx => {
        if (tx.name) {
            if (!customerSpending[tx.name]) customerSpending[tx.name] = 0;
            customerSpending[tx.name] += tx.total;
        }
    });
    const topCustomers = Object.entries(customerSpending).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topCustomersContainer = document.getElementById('top-customers-list');
    topCustomersContainer.innerHTML = topCustomers.length > 0 ? topCustomers.map(([name, total]) =>
        `<div class="flex justify-between items-center p-2 bg-gray-50 rounded">
            <span class="font-semibold">${name}</span>
            <span>₱${total.toFixed(2)}</span>
        </div>`
    ).join('') : `<p class="text-center text-gray-500 p-2">No customer data for this month.</p>`;

    regenerateDailyBreakdownTable();
}

function filterMonthlyReportTable(searchTerm) {
    const tableContainer = document.getElementById('daily-breakdown-table');
    const lowerCaseTerm = searchTerm.toLowerCase().trim();

    if (!lowerCaseTerm) {
        regenerateDailyBreakdownTable();
        return;
    }

    const filteredTransactions = monthlyReportTransactionCache.filter(tx => {
        const nameMatch = tx.name.toLowerCase().includes(lowerCaseTerm);
        const phoneMatch = tx.phone && tx.phone.includes(lowerCaseTerm);
        const orMatch = tx.orNumber.includes(lowerCaseTerm);
        return nameMatch || phoneMatch || orMatch;
    });

    if (filteredTransactions.length > 0) {
        let tableHtml = `<table class="w-full text-sm text-left"><thead class="text-xs text-gray-700 uppercase bg-gray-100"><tr><th class="px-4 py-2">Date & OR#</th><th class="px-4 py-2">Customer</th><th class="px-4 py-2 text-right">Total</th><th class="px-4 py-2 text-center">Actions</th></tr></thead><tbody>`;
        filteredTransactions.sort((a,b) => new Date(b.time) - new Date(a.time)).forEach(tx => {
             tableHtml += `<tr class="bg-white border-b">
                        <td class="px-4 py-2 font-medium"><div>${dayjs(tx.time).format('MMM DD')}</div><div class="text-xs text-gray-600">#${tx.orNumber}</div></td>
                        <td class="px-4 py-2">${tx.name}</td>
                        <td class="px-4 py-2 text-right font-semibold">₱${tx.total.toFixed(2)}</td>
                        <td class="px-4 py-2 text-center">
                            <button onclick="editTransaction('${tx.orNumber}')" class="bg-indigo-500 text-white px-2 py-1 rounded text-xs hover:bg-indigo-600">View/Edit</button>
                        </td>
                       </tr>`;
        });
        tableHtml += '</tbody></table>';
        tableContainer.innerHTML = tableHtml;
    } else {
        tableContainer.innerHTML = `<p class="text-center text-gray-500 p-6">No transactions found matching "${searchTerm}" in this month.</p>`;
    }
}

async function regenerateDailyBreakdownTable() {
    const reportMonthInput = document.getElementById('reportMonth').value;
    if (!reportMonthInput) return;

    const now = dayjs(reportMonthInput).tz(TIMEZONE);
    const currentMonthStart = now.startOf('month');
    const currentMonthEnd = now.endOf('month');

    const currentMonthSales = monthlyReportTransactionCache; 
    const collectedDataMap = await getCollectedDataForPeriod(currentMonthStart, currentMonthEnd);
    
    const daysInMonth = now.daysInMonth();
    const dailyBreakdown = {};
    const tableContainer = document.getElementById('daily-breakdown-table');
    for (let i = 1; i <= daysInMonth; i++) dailyBreakdown[i] = { sales: 0, orders: 0, collected: 0 };
    currentMonthSales.forEach(tx => { const d = dayjs(tx.time).tz(TIMEZONE).date(); dailyBreakdown[d].sales += tx.total; dailyBreakdown[d].orders++; });
    for (const [dateKey, amount] of Object.entries(collectedDataMap)) { const d = dayjs(dateKey).date(); if (dailyBreakdown[d]) dailyBreakdown[d].collected = amount; }
    
    let tableHtml = `<table class="w-full text-sm text-left"><thead class="text-xs text-gray-700 uppercase bg-gray-100"><tr><th class="px-4 py-2">Date</th><th class="px-4 py-2 text-right">Orders</th><th class="px-4 py-2 text-right">Total Sales</th><th class="px-4 py-2 text-right">Collected (Cash)</th><th class="px-4 py-2 text-center">Actions</th></tr></thead><tbody>`;
    for (let i = daysInMonth; i >= 1; i--) {
        const dayStr = `${now.year()}-${(now.month() + 1).toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
        tableHtml += `<tr class="bg-white border-b">
                        <td class="px-4 py-2 font-medium">${now.format('MMM')} ${i}</td>
                        <td class="px-4 py-2 text-right">${dailyBreakdown[i].orders}</td>
                        <td class="px-4 py-2 text-right">₱${dailyBreakdown[i].sales.toFixed(2)}</td>
                        <td class="px-4 py-2 text-right font-semibold">₱${dailyBreakdown[i].collected.toFixed(2)}</td>
                        <td class="px-4 py-2 text-center">
                            <button onclick="openDailyTransactionEditor('${dayStr}')" class="bg-indigo-500 text-white px-2 py-1 rounded text-xs hover:bg-indigo-600">Edit Day</button>
                        </td>
                       </tr>`;
    }
    tableHtml += '</tbody></table>';
    tableContainer.innerHTML = tableHtml;
}

async function openDailyTransactionEditor(dateString) {
    showLoading(true, `Loading transactions for ${dateString}...`);
    try {
        const dayStart = dayjs(dateString).startOf('day').toISOString();
        const dayEnd = dayjs(dateString).endOf('day').toISOString();
        const snapshot = await db.collection(COLLECTIONS.TRANSACTIONS)
                                 .where('time', '>=', dayStart)
                                 .where('time', '<=', dayEnd)
                                 .orderBy('time', 'desc')
                                 .get();
        const dailyTransactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        let transactionsHtml = '';
        if (dailyTransactions.length === 0) {
            transactionsHtml = '<p class="text-center text-gray-500">No transactions for this day.</p>';
        } else {
            transactionsHtml = dailyTransactions.map(tx => `
                <div class="swal-tx-item p-3 bg-white border rounded shadow-sm mb-2" data-search-content="${tx.orNumber} ${tx.name.toLowerCase()} ${tx.phone || ''}">
                    <div class="flex justify-between items-center">
                        <div>
                            <p class="font-bold">OR#: ${tx.orNumber}</p>
                            <p>${tx.name} (${tx.phone || 'N/A'})</p>
                            <p class="text-sm text-gray-500">Total: ₱${tx.total.toFixed(2)}</p>
                        </div>
                        <button onclick="editTransaction('${tx.orNumber}')" class="bg-yellow-500 text-white px-3 py-1 rounded text-xs hover:bg-yellow-600">Edit</button>
                    </div>
                </div>
            `).join('');
        }

        Swal.fire({
            title: `Transactions for ${dateString}`,
            html: `
                <input type="text" id="swal-daily-search" oninput="filterSwalList(this.value)" placeholder="Filter by OR#, Name, or Phone..." class="swal2-input mb-4">
                <div id="swal-tx-list" class="max-h-80 overflow-y-auto">${transactionsHtml}</div>
                <p id="swal-no-results" class="text-center text-gray-500 hidden mt-4">No transactions match your filter.</p>
            `,
            width: '600px',
            showConfirmButton: true,
            confirmButtonText: 'Done',
            didOpen: () => { showLoading(false); }
        });

    } catch (error) {
        console.error("Error opening daily transaction editor:", error);
        Swal.fire('Error', `Failed to load daily transactions: ${error.message}`, 'error');
        showLoading(false);
    }
}

function filterSwalList(searchTerm) {
    const lowerCaseTerm = searchTerm.toLowerCase();
    const listContainer = document.getElementById('swal-tx-list');
    const items = listContainer.querySelectorAll('.swal-tx-item');
    const noResultsMsg = document.getElementById('swal-no-results');
    let visibleCount = 0;

    items.forEach(item => {
        const content = item.dataset.searchContent;
        if (content.includes(lowerCaseTerm)) {
            item.style.display = 'block';
            visibleCount++;
        } else {
            item.style.display = 'none';
        }
    });

    noResultsMsg.style.display = visibleCount === 0 ? 'block' : 'none';
}


async function editTransaction(orNumber) {
    showLoading(true, `Loading OR# ${orNumber}...`);
    try {
        const txDoc = await db.collection(COLLECTIONS.TRANSACTIONS).doc(orNumber).get();
        if (!txDoc.exists) {
            Swal.fire('Not Found', `Transaction OR# ${orNumber} not found.`, 'error');
            showLoading(false);
            return;
        }
        let tx = txDoc.data();

        if (tx.balanceDue === undefined) { tx.balanceDue = Math.max(0, tx.total - (tx.amountPaid || 0)); }
        if (tx.smsSent === undefined) tx.smsSent = false;
        if (tx.dashboardFinished === undefined) tx.dashboardFinished = false;
        if (tx.notes === undefined) tx.notes = '';

        let cartItemsHtml = tx.cart.map((item, index) => `
            <div class="editable-cart-item">
                <span class="editable-cart-item-name">${item.label}</span>
                <input type="number" step="0.01" class="border p-1 w-20 text-right" value="${item.price.toFixed(2)}" data-index="${index}" data-field="price">
                <button class="text-red-500 ml-2" onclick="removeEditedCartItem(this, '${orNumber}', ${index})">&times;</button>
            </div>
        `).join('');

        const result = await Swal.fire({ 
            title: `Edit Order: OR# ${orNumber}`,
            html: `
                <div id="edit-transaction-form" class="text-left space-y-2">
                    <label for="edit-name">Customer Name:</label>
                    <input id="edit-name" class="swal2-input" value="${tx.name}">

                    <label for="edit-phone">Phone Number:</label>
                    <input id="edit-phone" class="swal2-input" value="${tx.phone || ''}">

                    <label for="edit-notes">Notes:</label>
                    <textarea id="edit-notes" class="swal2-textarea">${tx.notes || ''}</textarea>

                    <label for="edit-paymentType">Payment Type:</label>
                    <select id="edit-paymentType" class="swal2-select">
                        <option value="collection" ${tx.paymentType === 'collection' ? 'selected' : ''}>For Collection</option>
                        <option value="paid" ${tx.paymentType === 'paid' ? 'selected' : ''}>Fully Paid</option>
                        <option value="down_payment" ${tx.paymentType === 'down_payment' ? 'selected' : ''}>Down Payment</option>
                    </select>

                    <div class="mt-4 p-2 border rounded bg-gray-50">
                        <h5 class="font-bold mb-2">Order Items (Edit Prices):</h5>
                        <div id="edit-cart-items-container">
                            ${cartItemsHtml}
                        </div>
                         <div class="flex items-center gap-2 mt-3">
                            <select id="edit-add-service-select" class="border p-2 flex-grow">
                                <option value="">Add Service</option>
                                ${shopServices.map(s => `<option value="${s.id}" data-price="${s.price}" data-type="${s.type}">${s.label} (₱${s.price}${s.type === 'per_kg' ? '/kg' : ''})</option>`).join('')}
                            </select>
                            <input type="number" id="edit-add-service-weight" placeholder="kg (if per-kg)" class="border p-2 w-24">
                            <button onclick="addEditedCartItem()" class="bg-green-500 text-white px-3 py-1 rounded text-sm">Add</button>
                        </div>
                    </div>

                    <label for="edit-total">Calculated Total:</label>
                    <input id="edit-total" class="swal2-input" value="${tx.total.toFixed(2)}" readonly>
                    
                    <label for="edit-amountPaid">Amount Paid (Initial + Balance Paid):</label>
                    <input id="edit-amountPaid" type="number" step="0.01" class="swal2-input" value="${tx.amountPaid.toFixed(2)}">

                    <label for="edit-balanceDue">Balance Due:</label>
                    <input id="edit-balanceDue" type="number" step="0.01" class="swal2-input" value="${tx.balanceDue.toFixed(2)}" readonly>
                </div>
            `,
            width: '800px',
            showCancelButton: true,
            confirmButtonText: 'Save Changes',
            customClass: {
                container: 'edit-transaction-swal-container'
            },
            preConfirm: () => {
                const name = document.getElementById('edit-name').value.trim();
                const phone = document.getElementById('edit-phone').value.trim().replace(/\D/g, '');
                const notes = document.getElementById('edit-notes').value.trim();
                const paymentType = document.getElementById('edit-paymentType').value;
                const amountPaid = parseFloat(document.getElementById('edit-amountPaid').value);
                
                const updatedCart = [];
                document.querySelectorAll('#edit-cart-items-container .editable-cart-item').forEach(itemDiv => {
                    const label = itemDiv.querySelector('.editable-cart-item-name').textContent;
                    const price = parseFloat(itemDiv.querySelector('input[type="number"]').value);
                    if (!isNaN(price) && price > 0) {
                        updatedCart.push({ label, price });
                    }
                });

                const newTotal = updatedCart.reduce((sum, item) => sum + item.price, 0);

                if (!name || updatedCart.length === 0) {
                    Swal.showValidationMessage('Customer Name and at least one item are required.');
                    return false;
                }
                if (isNaN(amountPaid) || amountPaid < 0) {
                    Swal.showValidationMessage('Amount Paid must be a valid non-negative number.');
                    return false;
                }
                if (paymentType === 'paid' && amountPaid < newTotal) {
                    Swal.showValidationMessage('For "Fully Paid" orders, Amount Paid cannot be less than Total.');
                    return false;
                }
                if (paymentType === 'down_payment' && amountPaid > newTotal) {
                    Swal.showValidationMessage('For "Down Payment" orders, Amount Paid cannot be more than Total.');
                    return false;
                }

                return { name, phone, notes, paymentType, amountPaid, cart: updatedCart, total: newTotal };
            },
            didOpen: () => {
                showLoading(false);
                const cartItemsContainer = document.getElementById('edit-cart-items-container');
                cartItemsContainer.addEventListener('input', (e) => {
                    if (e.target.dataset.field === 'price') {
                        recalculateEditTransactionTotals();
                    }
                });
                document.getElementById('edit-paymentType').addEventListener('change', recalculateEditTransactionTotals);
                document.getElementById('edit-amountPaid').addEventListener('input', recalculateEditTransactionTotals);
                recalculateEditTransactionTotals(); 
            },
            showDenyButton: true,
            denyButtonText: 'Delete Order',
            denyButtonColor: '#d33'
        }).then(async (result) => {
            if (result.isConfirmed) {
                showLoading(true, 'Saving changes...');
                const updatedData = result.value; 
                let newBalanceDue = 0;
                let newChange = 0;
                let dashboardFinished = tx.dashboardFinished; 

                if (updatedData.paymentType === 'paid') {
                    newBalanceDue = 0;
                    newChange = updatedData.amountPaid - updatedData.total;
                    if (!shopSettings.smsEnabled) {
                         dashboardFinished = true;
                    } else {
                        if (tx.smsSent) { 
                            dashboardFinished = true;
                        } else {
                            dashboardFinished = false; 
                        }
                    }
                } else if (updatedData.paymentType === 'down_payment') {
                    newBalanceDue = updatedData.total - updatedData.amountPaid;
                    newChange = 0; 
                    if (newBalanceDue < 0) { 
                        newChange = Math.abs(newBalanceDue);
                        newBalanceDue = 0;
                    }
                    dashboardFinished = false; 
                } else if (updatedData.paymentType === 'collection') {
                    newBalanceDue = updatedData.total;
                    updatedData.amountPaid = 0; 
                    newChange = 0;
                    dashboardFinished = false; 
                }

                const finalUpdate = {
                    name: updatedData.name,
                    phone: updatedData.phone,
                    notes: updatedData.notes,
                    paymentType: updatedData.paymentType,
                    cart: updatedData.cart,
                    total: updatedData.total,
                    amountPaid: updatedData.amountPaid,
                    balanceDue: newBalanceDue,
                    change: newChange,
                    dashboardFinished: dashboardFinished,
                    smsSent: tx.smsSent,
                    _searchableKeywords: [updatedData.name.toLowerCase(), updatedData.phone, tx.orNumber].filter(Boolean)
                };

                if (tx.phone !== updatedData.phone && updatedData.phone) {
                    const oldCustomerRef = db.collection(COLLECTIONS.CUSTOMERS).doc(tx.phone);
                    const newCustomerRef = db.collection(COLLECTIONS.CUSTOMERS).doc(updatedData.phone);
                    await db.runTransaction(async t => {
                        const newCustomerDoc = await t.get(newCustomerRef);
                        if (newCustomerDoc.exists && newCustomerDoc.data().name !== updatedData.name) {
                            t.set(newCustomerRef, { name: updatedData.name, phone: updatedData.phone }, { merge: true });
                        } else if (!newCustomerDoc.exists) {
                            t.set(newCustomerRef, { name: updatedData.name, phone: updatedData.phone });
                        }
                    });
                } else if (updatedData.phone) {
                    await db.collection(COLLECTIONS.CUSTOMERS).doc(updatedData.phone).set({ name: updatedData.name, phone: updatedData.phone }, { merge: true });
                }

                await db.collection(COLLECTIONS.TRANSACTIONS).doc(orNumber).update(finalUpdate);
                Toast.fire({ icon: 'success', title: `Order ${orNumber} updated successfully!` });
                showLoading(false);
            } else if (result.isDenied) {
                const { isConfirmed: deleteConfirmed } = await Swal.fire({
                    title: 'Are you sure?',
                    text: `You are about to permanently delete OR# ${orNumber}. This cannot be undone.`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Yes, Delete It',
                    confirmButtonColor: '#d33'
                });
                if (deleteConfirmed) {
                    showLoading(true, 'Deleting order...');
                    await db.collection(COLLECTIONS.TRANSACTIONS).doc(orNumber).delete();
                    Toast.fire({ icon: 'success', title: `Order ${orNumber} deleted.` });
                    showLoading(false);
                }
            }
        });

    } catch (error) {
        console.error("Error editing transaction:", error);
        Swal.fire('Error', `Failed to load or save transaction: ${error.message}`, 'error');
        showLoading(false);
    }
}

function recalculateEditTransactionTotals() {
    let currentTotal = 0;
    document.querySelectorAll('#edit-cart-items-container .editable-cart-item input[type="number"]').forEach(input => {
        const price = parseFloat(input.value);
        if (!isNaN(price)) {
            currentTotal += price;
        }
    });
    document.getElementById('edit-total').value = currentTotal.toFixed(2);

    const paymentType = document.getElementById('edit-paymentType').value;
    const amountPaidInputEl = document.getElementById('edit-amountPaid');
    let amountPaid = parseFloat(amountPaidInputEl.value);
    let newBalanceDue = 0;

    if (paymentType === 'collection') {
        newBalanceDue = currentTotal;
        amountPaidInputEl.value = '0.00'; 
        amountPaidInputEl.readOnly = true;
    } else if (paymentType === 'down_payment') {
        newBalanceDue = Math.max(0, currentTotal - amountPaid);
        amountPaidInputEl.readOnly = false;
    } else if (paymentType === 'paid') {
        newBalanceDue = 0;
        if (isNaN(amountPaid) || amountPaid < currentTotal) {
             amountPaidInputEl.value = currentTotal.toFixed(2);
             amountPaid = currentTotal;
        }
        amountPaidInputEl.readOnly = false;
    }
    document.getElementById('edit-balanceDue').value = newBalanceDue.toFixed(2);
}

async function removeEditedCartItem(button, orNumber, index) {
    const { isConfirmed } = await Swal.fire({
        title: 'Remove Item?',
        text: 'Are you sure you want to remove this item?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, remove it!',
        confirmButtonColor: '#d33'
    });
    if (isConfirmed) {
        button.closest('.editable-cart-item').remove();
        recalculateEditTransactionTotals();
    }
}

function addEditedCartItem() {
    const select = document.getElementById('edit-add-service-select');
    const selectedOption = select.options[select.selectedIndex];
    const serviceId = selectedOption.value;
    const serviceLabel = selectedOption.textContent.split(' (₱')[0];
    const servicePrice = parseFloat(selectedOption.dataset.price);
    const serviceType = selectedOption.dataset.type;
    const weightInput = document.getElementById('edit-add-service-weight');
    let finalPrice = servicePrice;
    let itemLabel = serviceLabel;

    if (!serviceId) {
        return Swal.fire('No Service Selected', 'Please select a service to add.', 'warning');
    }

    if (serviceType === 'per_kg') {
        const weight = parseFloat(weightInput.value);
        if (isNaN(weight) || weight <= 0) {
            return Swal.fire('Invalid Weight', 'Please enter a valid weight in kg for this service.', 'warning');
        }
        finalPrice = weight * servicePrice;
        itemLabel = `${serviceLabel} (${weight}kg)`;
    }

    const cartItemsContainer = document.getElementById('edit-cart-items-container');
    const newItemDiv = document.createElement('div');
    newItemDiv.className = 'editable-cart-item';
    const tempIndex = cartItemsContainer.children.length; 
    newItemDiv.innerHTML = `
        <span class="editable-cart-item-name">${itemLabel}</span>
        <input type="number" step="0.01" class="border p-1 w-20 text-right" value="${finalPrice.toFixed(2)}" data-index="${tempIndex}" data-field="price">
        <button class="text-red-500 ml-2" onclick="removeEditedCartItem(this, '${null}', ${tempIndex})">&times;</button>
    `;
    cartItemsContainer.appendChild(newItemDiv);

    select.value = ''; 
    weightInput.value = ''; 
    recalculateEditTransactionTotals();
}


async function backupData() {
    showLoading(true, "Backing up all cloud data...");
    const backupData = {
        services: [], customers: [], transactions: [],
        config: {}, machineStatus: []
    };
    const servicesSnap = await db.collection(COLLECTIONS.SERVICES).get(); backupData.services = servicesSnap.docs.map(d => ({...d.data(), id: d.id}));
    const customersSnap = await db.collection(COLLECTIONS.CUSTOMERS).get(); backupData.customers = customersSnap.docs.map(d => d.data());
    const transactionsSnap = await db.collection(COLLECTIONS.TRANSACTIONS).get(); backupData.transactions = transactionsSnap.docs.map(d => d.data());
    const machineStatusSnap = await db.collection(COLLECTIONS.MACHINE_STATUS).get(); backupData.machineStatus = machineStatusSnap.docs.map(d => d.data());
    const configSnap = await db.collection(COLLECTIONS.CONFIG).get(); configSnap.forEach(d => backupData.config[d.id] = d.data());
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(backupData, null, 2)], {type: "application/json"})); a.download = `laundry_pos_backup_${dayjs().format('YYYY-MM-DD')}.json`; a.click(); URL.revokeObjectURL(a.href);
    showLoading(false);
    Toast.fire({icon: 'success', title: 'Cloud backup downloaded!'});
}

function triggerRestore() { Swal.fire({ title: 'Restore Data to Cloud?', text: 'This will overwrite ALL cloud data.', icon: 'warning', input: 'file', inputAttributes:{'accept':'application/json'}, showCancelButton:true, confirmButtonText:'Upload & Restore', confirmButtonColor:'#d33', }).then(r => r.isConfirmed && r.value && restoreData(r.value)); }

async function restoreData(file) {
    showLoading(true, "Reading backup file...");
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            let dataToRestore = JSON.parse(e.target.result);
            if (dataToRestore.global_or_counter !== undefined || dataToRestore.shop_customers !== undefined) {
                showLoading(true, "Old backup detected. Converting...");
                Toast.fire({icon: 'info', title: 'Old backup detected, converting...'});
                dataToRestore = transformOldBackupToNewFormat(dataToRestore);
            }
            showLoading(true, "Starting restore...");
            const commitBatchInChunks = async (collectionName, data, idField) => {
                let batch = db.batch();
                let operationCount = 0;
                const totalItems = data.length;
                for (let i = 0; i < totalItems; i++) {
                    const item = data[i];
                    const docId = item[idField];
                    if (!docId) { console.warn(`Skipping item in ${collectionName} due to missing ID:`, item); continue; }
                    const docRef = db.collection(collectionName).doc(String(docId));
                    batch.set(docRef, item);
                    operationCount++;
                    if (i % 25 === 0) { showLoading(true, `Restoring ${collectionName}... (${i + 1}/${totalItems})`); }
                    if (operationCount >= 499) { await batch.commit(); batch = db.batch(); operationCount = 0; }
                }
                if (operationCount > 0) { await batch.commit(); }
            };
            if (dataToRestore.services?.length) await commitBatchInChunks(COLLECTIONS.SERVICES, dataToRestore.services, 'id');
            if (dataToRestore.customers?.length) await commitBatchInChunks(COLLECTIONS.CUSTOMERS, dataToRestore.customers, 'id');
            if (dataToRestore.transactions?.length) await commitBatchInChunks(COLLECTIONS.TRANSACTIONS, dataToRestore.transactions, 'orNumber');
            showLoading(true, "Finalizing configuration...");
            const finalBatch = db.batch();
            dataToRestore.machineStatus?.forEach(m => finalBatch.set(db.collection(COLLECTIONS.MACHINE_STATUS).doc(m.id), m));
            if (dataToRestore.config) { Object.entries(dataToRestore.config).forEach(([key, val]) => finalBatch.set(db.collection(COLLECTIONS.CONFIG).doc(key), val)); }
            await finalBatch.commit();
            Swal.fire('Success!', 'Data restored successfully. The application will now reload.', 'success').then(() => location.reload());
        } catch (err) {
            console.error("Restore failed:", err);
            Swal.fire('Error', `Restore failed. Error: ${err.message}`, 'error');
        } finally {
            showLoading(false);
        }
    };
    reader.readAsText(file);
}

function transformOldBackupToNewFormat(oldData) {
    const newData = { services: [], customers: [], transactions: [], config: {}, machineStatus: [] };
    if (Array.isArray(oldData.shop_services)) { newData.services = oldData.shop_services.filter(s => s && typeof s.label === 'string' && s.label.trim() !== '').map(s => { const id = s.id ? String(s.id) : s.label.trim().replace(/\s+/g, '_').replace(/[^\w-]/g, ''); return { ...s, id: id }; }); }
    if (Array.isArray(oldData.shop_customers)) { newData.customers = oldData.shop_customers.filter(c => c && c.name).map(c => { const phone = c.phone || ""; const invalidPhoneValues = ["none", "n", "n.", "no"]; const isValidPhone = typeof phone === 'string' && phone.trim().length > 3 && !invalidPhoneValues.includes(phone.toLowerCase().trim()); const id = isValidPhone ? phone : String(c.id); return { ...c, id: id }; }); }
    newData.machineStatus = oldData.machine_status || [];
    newData.config.shopSettings = oldData.shop_settings || {};
    newData.config.orCounter = { value: oldData.global_or_counter || 0 };
    newData.config.appPassword = { value: oldData.app_password || 'root' };
    newData.config.machineConfig = oldData.machine_config || { numWashers: 2, numDryers: 2 };
    const transactionMap = new Map();
    for (const key in oldData) { if (/^\d{4}-\d{2}-\d{2}$/.test(key)) { if (Array.isArray(oldData[key])) { oldData[key].forEach(tx => { if (tx && tx.orNumber) transactionMap.set(tx.orNumber, tx); }); } } }
    if (oldData.pending_pickups) { const pending = Array.isArray(oldData.pending_pickups) ? oldData.pending_pickups : Object.values(oldData.pending_pickups); pending.forEach(tx => { if (tx && tx.orNumber) transactionMap.set(tx.orNumber, tx); }); }
    newData.transactions = Array.from(transactionMap.values()).map(tx => {
        let calculatedBalanceDue = 0;
        if (tx.paymentType === 'collection') { calculatedBalanceDue = tx.total; } else if (tx.paymentType === 'down_payment') { calculatedBalanceDue = Math.max(0, tx.total - (tx.amountPaid || 0)); } else { calculatedBalanceDue = 0;}
        const invalidPhoneValues = ["none", "n", "n.", "no"];
        let cleanPhone = tx.phone || "";
        if (typeof cleanPhone === 'string' && invalidPhoneValues.includes(cleanPhone.toLowerCase().trim())) { cleanPhone = ""; }
        return {
            ...tx,
            phone: cleanPhone,
            balanceDue: calculatedBalanceDue,
            smsSent: tx.smsSent || false,
            dashboardFinished: (tx.paymentType === 'paid' && !shopSettings.smsEnabled) || false,
            notes: tx.notes || "",
            _searchableKeywords: [(tx.name || "").toLowerCase(), cleanPhone, tx.orNumber || ""].filter(Boolean)
        };
    });
    console.log(`Transformed: ${newData.transactions.length} transactions, ${newData.customers.length} customers, and ${newData.services.length} services.`);
    return newData;
}


async function confirmTransactionalReset() {
    const r = await Swal.fire({title:'Reset Sales Data?',text:'This will delete ALL sales and reset OR number.',icon:'warning',showCancelButton:true,confirmButtonColor:'#d33',confirmButtonText:'Yes, Reset Sales'});
    if(r.isConfirmed){ showLoading(true); const snap = await db.collection(COLLECTIONS.TRANSACTIONS).get(); const batch=db.batch(); snap.docs.forEach(d => batch.delete(d.ref)); batch.set(db.collection(COLLECTIONS.CONFIG).doc('orCounter'), {value:0}); await batch.commit(); showLoading(false); Swal.fire('Reset Complete','Sales data cleared.','success').then(()=>location.reload()); }
}

async function confirmMasterReset() {
    const r = await Swal.fire({title:'FACTORY RESET?',text:'This deletes EVERYTHING from the cloud.',icon:'error',showCancelButton:true,confirmButtonColor:'#d33',confirmButtonText:'Yes, Delete Everything'});
    if(r.isConfirmed){ showLoading(true); await Promise.all([ 'transactions', 'customers', 'services', 'config', 'machineStatus' ].map(async coll => { const snap = await db.collection(coll).get(); const batch=db.batch(); snap.docs.forEach(d => batch.delete(d.ref)); await batch.commit(); })); showLoading(false); Swal.fire('Factory Reset Complete','All data erased.','success').then(()=>location.reload()); }
}

async function sendTestSms() {
    const username = allElements.settingSmsUsername.value.trim();
    const password = allElements.settingSmsPassword.value.trim();
    const testPhoneNumber = allElements.smsTestPhoneNumber.value.trim();
    const shopName = allElements.settingShopName.value.trim() || "Your Laundry Shop";

    if (!username || !password) {
        return Swal.fire('Missing Credentials', 'Please enter your API Username and Password in the fields above before sending a test.', 'warning');
    }
    if (!testPhoneNumber) {
        return Swal.fire('Missing Phone Number', 'Please enter a phone number to send the test message to.', 'warning');
    }

    let formattedPhone = testPhoneNumber.replace(/\D/g, '');
    if (formattedPhone.startsWith('09') && formattedPhone.length === 11) {
        formattedPhone = '+63' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('639') && formattedPhone.length === 12) {
        formattedPhone = '+' + formattedPhone;
    }

    if (!formattedPhone.startsWith('+639')) {
         return Swal.fire('Invalid Phone Format', `The phone number '${testPhoneNumber}' must be a valid Philippine mobile number (e.g., +639xxxxxxxxx).`, 'error');
    }

    const testMessage = `This is a test message from ${shopName}. Your SMS configuration is working!`;
    const PROXY_URL = 'https://corsproxy.io/?';
    const API_URL = PROXY_URL + encodeURIComponent('https://api.sms-gate.app/3rdparty/v1/messages');

    showLoading(true, 'Sending test SMS...');
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(username + ':' + password),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: testMessage,
                phoneNumbers: [formattedPhone]
            })
        });

        if (response.ok) {
            Swal.fire('Success!', 'Test SMS sent successfully. Check the target phone.', 'success');
        } else {
            const errorResult = await response.json().catch(() => ({ message: 'An unknown API error occurred.' }));
            Swal.fire('Test Failed', `The API returned an error: ${errorResult.message || response.statusText}.`, 'error');
        }
    } catch (error) {
        Swal.fire('Network Error', `Could not send the test message. Please check your internet connection. Error: ${error.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

async function sendPickupReadySms(orNumber, customerPhone, customerName) {
    if (!shopSettings.smsEnabled) return;
    const { smsUsername, smsPassword, smsPickupMessageTemplate } = shopSettings;

    if (!smsUsername || !smsPassword) {
        return Swal.fire('SMS Not Configured', 'Please set your API Username and Password in Owner Settings > Shop Config.', 'warning');
    }
    if (!customerPhone) return Swal.fire('Error', `Customer phone number is missing for OR# ${orNumber}.`, 'error');

    let formattedPhone = customerPhone.replace(/\D/g, '');
    if (formattedPhone.startsWith('09') && formattedPhone.length === 11) {
        formattedPhone = '+63' + formattedPhone.substring(1);
    } else if (formattedPhone.startsWith('639') && formattedPhone.length === 12) {
        formattedPhone = '+' + formattedPhone;
    }

    if (!formattedPhone.startsWith('+639')) {
        return Swal.fire('Invalid Phone Format', `The phone number '${customerPhone}' must be in a valid format (e.g., +639xxxxxxxxx).`, 'error');
    }

    let message = smsPickupMessageTemplate
        .replace(/\[Customer Name\]/g, customerName)
        .replace(/\[OR Number\]/g, orNumber)
        .replace(/\[Shop Name\]/g, shopSettings.name);

    const { isConfirmed } = await Swal.fire({
        title: 'Send "Ready for Pickup" SMS?',
        html: `<p>To: <strong>${customerName} (${formattedPhone})</strong></p><p>Message:</p><p class="text-left bg-gray-100 p-3 rounded">${message}</p>`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Yes, Send SMS',
        confirmButtonColor: '#8a2be2'
    });

    if (!isConfirmed) return;

    showLoading(true, 'Sending SMS...');
    try {
        const PROXY_URL = 'https://corsproxy.io/?';
        const API_URL = PROXY_URL + encodeURIComponent('https://api.sms-gate.app/3rdparty/v1/messages');
        
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(smsUsername + ':' + password),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                phoneNumbers: [formattedPhone]
            })
        });

        if (response.ok) {
            Toast.fire({ icon: 'success', title: 'SMS sent successfully!' });
            const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(orNumber);
            const currentTx = (await txRef.get()).data();
            
            let updateData = { smsSent: true };

            if (currentTx.paymentType === 'paid' && currentTx.balanceDue === 0) {
                updateData.dashboardFinished = true;
            }
            
            await txRef.update(updateData);

        } else {
            const errorResult = await response.json().catch(() => ({ message: 'Unknown API error' }));
            Swal.fire('SMS Failed', `API Error: ${errorResult.message || response.statusText}.`, 'error');
        }
    } catch (error) {
        Swal.fire('SMS Error', `An error occurred: ${error.message}.`, 'error');
    } finally {
        showLoading(false);
    }
}

async function openCustomerPromoManager() {
    if (!shopSettings.smsEnabled || !shopSettings.smsUsername || !shopSettings.smsPassword) {
        return Swal.fire('SMS Not Configured', 'Please set your API Username and Password in Owner Settings > Shop Config before sending promos.', 'warning');
    }

    const { value: formValues, isConfirmed } = await Swal.fire({
        title: 'Customer Promo SMS Sender',
        html: `
            <div class="text-left space-y-4">
                <div>
                    <label for="swal-promo-message" class="font-semibold">Promotional Message:</label>
                    <textarea id="swal-promo-message" class="swal2-textarea" placeholder="E.g., Special promo this week! Get 10% off on all services."></textarea>
                </div>
                <div class="flex items-end gap-2">
                    <div class="flex-grow">
                        <label for="swal-promo-filter" class="font-semibold">Load Customers:</label>
                        <select id="swal-promo-filter" class="swal2-select">
                            <option value="all">All Customers with Phone Number</option>
                            <option value="active_30">Active (Last 30 Days)</option>
                            <option value="active_60">Active (Last 60 Days)</option>
                            <option value="active_90">Active (Last 90 Days)</option>
                            <option value="inactive_7">Inactive (7+ Days)</option>
                            <option value="inactive_30">Inactive (30+ Days)</option>
                            <option value="inactive_60">Inactive (60+ Days)</option>
                            <option value="inactive_90">Inactive (90+ Days)</option>
                        </select>
                    </div>
                    <button type="button" id="swal-load-customers-btn" class="bg-blue-500 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-blue-600">Load</button>
                </div>
                <div id="swal-promo-controls" class="flex justify-between items-center text-sm mt-2">
                    <div class="flex items-center gap-2">
                        <input type="checkbox" id="swal-promo-select-all">
                        <label for="swal-promo-select-all">Select All / Deselect All</label>
                    </div>
                    <span id="swal-promo-selected-count" class="font-bold">Selected: 0 customer(s)</span>
                </div>
                <div id="swal-promo-recipients-box">
                    <p class="text-center text-gray-500 p-4">Select a filter and click "Load" to see recipients.</p>
                </div>
            </div>
        `,
        width: '800px',
        showCancelButton: true,
        confirmButtonText: 'Send to Selected',
        cancelButtonText: 'Close',
        didOpen: () => {
            document.getElementById('swal-load-customers-btn').addEventListener('click', handleLoadPromoCustomers);
            document.getElementById('swal-promo-select-all').addEventListener('change', (e) => {
                document.querySelectorAll('.swal-promo-recipient-check').forEach(checkbox => {
                    checkbox.checked = e.target.checked;
                });
                updatePromoSelectedCount();
            });
            document.getElementById('swal-promo-recipients-box').addEventListener('change', (e) => {
                if (e.target.classList.contains('swal-promo-recipient-check')) {
                    updatePromoSelectedCount();
                }
            });
        },
        preConfirm: () => {
            const message = document.getElementById('swal-promo-message').value;
            if (!message.trim()) {
                Swal.showValidationMessage('Promotional message cannot be empty.');
                return false;
            }

            const selectedRecipients = [];
            document.querySelectorAll('.swal-promo-recipient-check:checked').forEach(checkbox => {
                selectedRecipients.push({
                    name: checkbox.dataset.name,
                    phone: checkbox.dataset.phone
                });
            });

            if (selectedRecipients.length === 0) {
                Swal.showValidationMessage('You must select at least one customer to send the promo to.');
                return false;
            }
            return { message, recipients: selectedRecipients };
        }
    });

    if (isConfirmed && formValues) {
        await sendBulkPromo(formValues.message, formValues.recipients);
    }
}

async function handleLoadPromoCustomers() {
    const filter = document.getElementById('swal-promo-filter').value;
    const recipientsBox = document.getElementById('swal-promo-recipients-box');
    recipientsBox.innerHTML = '<div class="inline-loader"></div>';
    
    try {
        const recipients = await getPromoRecipients(filter);
        if (recipients.length === 0) {
             recipientsBox.innerHTML = '<p class="text-center text-gray-500 p-4">No customers found for this filter.</p>';
        } else {
            recipientsBox.innerHTML = recipients.map(cust => `
                <div class="promo-recipient-item">
                    <div class="flex items-center gap-2">
                        <input type="checkbox" class="swal-promo-recipient-check" data-phone="${cust.phone}" data-name="${cust.name}">
                        <div>
                            <div class="font-semibold">${cust.name}</div>
                            <div class="text-xs text-gray-600">${cust.phone}</div>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error("Error fetching promo recipients:", error);
        recipientsBox.innerHTML = '<p class="text-center text-red-500 p-4">Error fetching recipients.</p>';
    }
    updatePromoSelectedCount();
}

function updatePromoSelectedCount() {
    const count = document.querySelectorAll('.swal-promo-recipient-check:checked').length;
    document.getElementById('swal-promo-selected-count').textContent = `Selected: ${count} customer(s)`;
}


async function getPromoRecipients(filter) {
    const uniqueCustomers = new Map(); 

    if (filter === 'all') {
        const snapshot = await db.collection(COLLECTIONS.CUSTOMERS).get();
        snapshot.docs.forEach(doc => {
            const cust = doc.data();
            if (cust.phone) uniqueCustomers.set(cust.phone, cust);
        });
    } else {
        const [type, daysStr] = filter.split('_');
        const days = parseInt(daysStr, 10);
        const cutoffDate = dayjs().subtract(days, 'day').toISOString();
        
        if (type === 'active') {
            const snapshot = await db.collection(COLLECTIONS.TRANSACTIONS).where('time', '>=', cutoffDate).get();
            snapshot.docs.forEach(doc => {
                const tx = doc.data();
                if (tx.phone) uniqueCustomers.set(tx.phone, { name: tx.name, phone: tx.phone });
            });
        } else if (type === 'inactive') {
            const allCustomersSnapshot = await db.collection(COLLECTIONS.CUSTOMERS).get();
            const allCustomersMap = new Map();
            allCustomersSnapshot.docs.forEach(doc => {
                const cust = doc.data();
                if (cust.phone) allCustomersMap.set(cust.phone, cust);
            });

            const activeSnapshot = await db.collection(COLLECTIONS.TRANSACTIONS).where('time', '>=', cutoffDate).get();
            activeSnapshot.docs.forEach(doc => {
                const tx = doc.data();
                if (tx.phone && allCustomersMap.has(tx.phone)) {
                    allCustomersMap.delete(tx.phone);
                }
            });
            return Array.from(allCustomersMap.values());
        }
    }
    return Array.from(uniqueCustomers.values());
}

async function sendBulkPromo(message, recipients) {
    cancelPromoSend = false; 
    const { smsUsername, smsPassword } = shopSettings;
    const total = recipients.length;
    let successCount = 0;
    let failCount = 0;
    
    const swalRef = Swal.fire({
        title: 'Sending Promotional SMS...',
        html: `
            <div class="w-full bg-gray-200 rounded-full h-4 mt-4">
                <div id="bulk-progress-bar" class="bg-blue-600 h-4 rounded-full text-xs font-medium text-blue-100 text-center p-0.5 leading-none" style="width: 0%">0%</div>
            </div>
            <p id="bulk-status-text" class="mt-2 text-sm">Initializing...</p>
        `,
        allowOutsideClick: false,
        showConfirmButton: false,
        showDenyButton: true,
        denyButtonText: 'Cancel',
        didOpen: () => {
            Swal.getDenyButton().addEventListener('click', () => {
                cancelPromoSend = true;
            });
        }
    });

    const progressBar = document.getElementById('bulk-progress-bar');
    const statusText = document.getElementById('bulk-status-text');

    for (let i = 0; i < total; i++) {
        if (cancelPromoSend) {
            statusText.textContent = 'Cancelling...';
            break;
        }
        const customer = recipients[i];
        const progress = Math.round(((i + 1) / total) * 100);
        statusText.textContent = `Sending to ${customer.name} (${i + 1} of ${total})...`;
        progressBar.style.width = `${progress}%`;
        progressBar.textContent = `${progress}%`;

        let formattedPhone = (customer.phone || '').replace(/\D/g, '');
        if (formattedPhone.startsWith('09') && formattedPhone.length === 11) {
            formattedPhone = '+63' + formattedPhone.substring(1);
        } else if (formattedPhone.startsWith('639') && formattedPhone.length === 12) {
            formattedPhone = '+' + formattedPhone;
        }

        if (formattedPhone.startsWith('+639')) {
            try {
                const PROXY_URL = 'https://corsproxy.io/?';
                const API_URL = PROXY_URL + encodeURIComponent('https://api.sms-gate.app/3rdparty/v1/messages');
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Authorization': 'Basic ' + btoa(smsUsername + ':' + smsPassword),
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ message: message, phoneNumbers: [formattedPhone] })
                });
                if (response.ok) { successCount++; } else { failCount++; }
            } catch (error) {
                failCount++;
            }
        } else {
            failCount++; 
        }
        await new Promise(resolve => setTimeout(resolve, 500)); 
    }
    
    const finalTitle = cancelPromoSend ? 'Promo Sending Cancelled' : 'Promo Sending Complete!';
    const finalText = `Successfully sent: ${successCount}. Failed: ${failCount}.`;
    Swal.fire(finalTitle, finalText, 'info');
}

async function getSalesDataForPeriod(startDate, endDate) {
    const snapshot = await db.collection(COLLECTIONS.TRANSACTIONS)
        .where('time', '>=', startDate.toISOString())
        .where('time', '<=', endDate.toISOString())
        .get();
    return snapshot.docs.map(doc => doc.data());
}

   async function getCollectedDataForPeriod(startDate, endDate) {
    const collectedDataMap = {}; 
    const snapshot = await db.collection(COLLECTIONS.TRANSACTIONS)
        .where('paymentTimestamp', '>=', startDate.toISOString())
        .where('paymentTimestamp', '<=', endDate.toISOString())
        .get();

    snapshot.docs.forEach(doc => {
        const tx = doc.data();
        const paymentDay = dayjs(tx.paymentTimestamp).tz(TIMEZONE).format('YYYY-MM-DD');
        let collectedAmount = 0;

        // This logic correctly identifies the amount collected AT THE TIME of the paymentTimestamp.
        if (tx.balancePaidAmount) { // It was a balance payment.
             collectedAmount = tx.balancePaidAmount;
        } else if (tx.paymentType === 'down_payment') { // It was an initial down payment.
             collectedAmount = tx.amountPaid;
        } else if (tx.paymentType === 'paid') { // It was a full payment from the start.
             collectedAmount = tx.total; // The actual revenue is the total, not amountPaid (which may include customer change).
        }

        // Add the collected amount to the map for the correct day.
        collectedDataMap[paymentDay] = (collectedDataMap[paymentDay] || 0) + collectedAmount;
    });
    return collectedDataMap;
}

// --- App Initializer ---
document.addEventListener('DOMContentLoaded', promptStaffLogin);
```