let itemCount = 1;

let allProducts = [];

async function loadProductData() {
    allProducts = await eel.load_products()();
    populateBootstrapDropdown('productDropdown', allProducts);
}

function populateBootstrapDropdown(dropdownId, products) {
    const dropdown = document.getElementById(dropdownId);
    dropdown.innerHTML = '';

    // Add header
    const header = document.createElement('li');
    header.className = 'list-group-item active';
    header.textContent = 'Select Product';
    dropdown.appendChild(header);

    // Add products
    products.forEach(line => {
        const [productId, item, price] = line;
        const li = document.createElement('li');
        li.className = 'list-group-item list-group-item-action';
        li.dataset.product = item;
        li.dataset.price = price;
        li.style.cursor = 'pointer';
        li.innerHTML = `${item} <span class="badge bg-secondary ms-2">฿${parseFloat(price).toFixed(2)}</span>`;

        li.onmousedown = function(e) {
            e.preventDefault(); // Prevent blur event
            selectProduct(item, price, dropdownId);
        };

        dropdown.appendChild(li);
    });

    // Add no results message (initially hidden)
    const noResults = document.createElement('li');
    noResults.className = 'list-group-item text-muted d-none';
    noResults.textContent = 'No products found';
    noResults.id = dropdownId + 'NoResults';
    dropdown.appendChild(noResults);
}

function removeItemRow(button) {
    button.parentNode.parentNode.remove(); // Remove the parent row
}

function selectProduct(productName, productPrice, dropdownId) {
    if (dropdownId === 'productDropdown') {
        addItemRow(productName, productPrice);
        document.getElementById('productSearch').value = '';
    } else if (dropdownId === 'editProductDropdown') {
        addEditItemRow(productName, productPrice);
        document.getElementById('editProductSearch').value = '';
    }
}

function showProductDropdown() {
    const dropdown = document.getElementById('productDropdown');
    dropdown.style.display = 'block';
}

function hideProductDropdown() {
    setTimeout(() => {
        const dropdown = document.getElementById('productDropdown');
        dropdown.style.display = 'none';
    }, 200);
}

function showEditProductDropdown() {
    const dropdown = document.getElementById('editProductDropdown');
    dropdown.style.display = 'block';
}

function hideEditProductDropdown() {
    setTimeout(() => {
        const dropdown = document.getElementById('editProductDropdown');
        dropdown.style.display = 'none';
    }, 200);
}

function filterProducts(searchTerm) {
    filterDropdownItems('productDropdown', searchTerm);
}

function filterEditProducts(searchTerm) {
    filterDropdownItems('editProductDropdown', searchTerm);
}

function filterDropdownItems(dropdownId, searchTerm) {
    const dropdown = document.getElementById(dropdownId);
    const items = dropdown.querySelectorAll('.list-group-item');
    const noResultsElement = document.getElementById(dropdownId + 'NoResults');
    let hasVisibleItems = false;

    searchTerm = searchTerm.toLowerCase();

    items.forEach(item => {
        if (item.dataset.product) {
            const productName = item.dataset.product.toLowerCase();
            if (productName.includes(searchTerm)) {
                item.classList.remove('d-none');
                hasVisibleItems = true;
            } else {
                item.classList.add('d-none');
            }
        }
    });

    // Show/hide no results message
    if (hasVisibleItems || searchTerm === '') {
        noResultsElement.classList.add('d-none');
    } else {
        noResultsElement.classList.remove('d-none');
    }
}

function addItemRow(item = "", price = "") {
    itemCount++;
    let container = document.getElementById('items_container');
    let newRow = document.createElement('div');
    newRow.classList.add('row', 'mb-2', 'item_row');
    newRow.style.paddingRight = "0";

    newRow.innerHTML = `
        <div class="input-group mb-2" style="padding-right: 0;">
            <input type="text" class="form-control product" style="width: 30%" value="${item}" disabled />
            <span class="input-group-text">฿</span>
            <input type="text" class="form-control price" value="${(Math.round(price * 100) / 100).toFixed(2)}" disabled />
            <input type="number" class="form-control quantity" placeholder="Qty" min="1" value="1">
            <button onclick="removeItemRow(this)" class="form-control btn btn-danger btn-sm">Remove</button>
        </div>
    `;
    container.appendChild(newRow);
}

async function saveOrder(event) {
    event.preventDefault();

    let customerName = document.querySelector('.customer').value;
    let productElements = document.querySelectorAll('.product');
    let quantityElements = document.querySelectorAll('.quantity');
    let priceElements = document.querySelectorAll('.price');
    let discountType = document.getElementById('discountType').value;
    let discount = document.getElementById('discountInput').value;
    let deliveryFee = document.getElementById('deliveryFee').value;

    if (productElements.length === 0) {
        showAlertModal('Please add at least one product.');
        return;
    }

    // Validate discount: if type is selected but no value provided, reset to 'none'
    if ((discountType === 'percentage' || discountType === 'amount') && (!discount || discount.trim() === '' || parseFloat(discount) <= 0)) {
        discountType = 'none';
        discount = '0';
    }

    // Ensure delivery fee has a valid value
    if (!deliveryFee || deliveryFee.trim() === '') {
        deliveryFee = '0';
    }

    let products = Array.from(productElements).map(el => el.value);
    let quantities = Array.from(quantityElements).map(el => el.value);
    let prices = Array.from(priceElements).map(el => el.value);

    await eel.save_order(products, quantities, prices, customerName, discountType, discount, deliveryFee)();
    displayOrders();
}

async function displayOrders() {
    const currentPage = $('#orderTable').DataTable().page();
    $('#orderTable').DataTable().destroy();

    const orderTable = document.getElementById('orderTable').querySelector('tbody');
    orderTable.innerHTML = ''; // Clear existing order rows

    let orders = await eel.load_orders()(); // Load orders from CSV            
    orders.forEach(order => {
        let row = orderTable.insertRow();
        let dateCell = row.insertCell();
        let customerCell = row.insertCell();
        let itemsCell = row.insertCell();
        let discountCell = row.insertCell();
        let deliveryFeeCell = row.insertCell();
        let totalCell = row.insertCell();
        let actionCell = row.insertCell();
        actionCell.classList.add('text-center');

        let items = order[2].split('|');
        let quantities = order[3].split('|');
        let itemsHtml = '';

        items.forEach((item, index) => { // Include 'index'
            let itemName = item.trim();
            let quantity = quantities[index].trim(); // Access quantity by index

            itemsHtml += `${quantity}x ${itemName}<br>`;
        });

        dateCell.textContent = order[0];
        customerCell.textContent = order[1];
        itemsCell.innerHTML = itemsHtml;
        discountCell.textContent = order[7];
        deliveryFeeCell.textContent = order[8];
        totalCell.textContent = "฿" + order[9];

        let orderID = order[0].replace(/'/g, "\\'");
        let customerName = order[1].replace(/'/g, "\\'");
        let orderItem = order[2].replace(/'/g, "\\'");
        let orderQuantity = order[3].replace(/'/g, "\\'");
        let orderPrice = order[4].replace(/'/g, "\\'");
        let discountType = order[5];
        let discount = order[6];
        let deliveryFee = order[8];

        actionCell.innerHTML = `
            <div class="d-flex justify-content-center">
                <button class="btn btn-secondary me-1" onclick="printReceipt('${customerName}', '${orderItem}', '${orderQuantity}', '${orderPrice}', '${discountType}', '${discount}', '${deliveryFee}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-printer-fill" viewBox="0 0 16 16">
                        <path d="M5 1a2 2 0 0 0-2 2v1h10V3a2 2 0 0 0-2-2zm6 8H5a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1"/>
                        <path d="M0 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1v-2a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2H2a2 2 0 0 1-2-2zm2.5 1a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1"/>
                    </svg>
                </button>
                <button class="btn me-1" onclick="editOrder('${orderID}', '${customerName}', '${orderItem}', '${orderQuantity}', '${orderPrice}', '${discountType}', '${discount}', '${deliveryFee}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="blue" class="bi bi-pencil-square" viewBox="0 0 16 16">
                        <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/>
                        <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"/>
                    </svg>
                </button>
                <button class="btn" onclick="deleteOrder('${orderID}', '${customerName}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="red" class="bi bi-x-circle-fill" viewBox="0 0 16 16">
                        <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z"/>
                    </svg>
                </button>
            </div>
        `;
    });

    $.fn.dataTable.moment('DD/MM/YYYY HH:mm');

    $('#orderTable').DataTable({
        "pageLength": 5,
        "lengthChange": false,
        "searching": false,
        "order": [[0, "desc"]],
        "columnDefs": [
            { "orderable": false, "targets": [-1, -2] }
        ]
    }).page(currentPage).draw('page');
}

async function printReceipt(customer_name, items, quantities, prices, discountType, discount, deliveryFee) {
    const spinnerWrapperEl = document.querySelector('.spinner-wrapper');

	try {
        spinnerWrapperEl.style.opacity = 0.5;
		spinnerWrapperEl.style.display = 'flex';
        
        const itemList = items.split('|').map(item => item.trim());
        const quantityList = quantities.split('|').map(qty => qty.trim());
        const priceList = prices.split('|').map(price => price.trim());

        var result = await eel.print_receipt(itemList, quantityList, priceList, customer_name, discountType, discount, deliveryFee)();

        showAlertModal(result);
    } catch (e) {
		showAlertModal(e);
	} finally {
		spinnerWrapperEl.style.opacity = 0;

		setTimeout(() => {
			spinnerWrapperEl.style.display = 'none';			
		}, 200);
	}
}

async function editOrder(date, customer, items, quantities, prices, discountType, discount, deliveryFee) {
    const editModal = new bootstrap.Modal(document.getElementById('editOrderModal'));

    // Store original values for reference
    document.getElementById('original-order-date').value = date;
    document.getElementById('original-order-customer').value = customer;

    // Populate form with current values
    document.getElementById('edit-customer-name').value = customer;
    document.getElementById('edit-discount-type').value = discountType;
    document.getElementById('edit-discount-input').value = discount;
    document.getElementById('edit-delivery-fee').value = deliveryFee;

    // Load products into the edit dropdown
    await loadEditProductData();

    // Clear and populate items
    const itemsContainer = document.getElementById('edit-items-container');
    itemsContainer.innerHTML = '';

    const itemsArray = items.split('|');
    const quantitiesArray = quantities.split('|');
    const pricesArray = prices.split('|');

    itemsArray.forEach((item, index) => {
        addEditItemRow(item.trim(), pricesArray[index].trim(), quantitiesArray[index].trim());
    });

    editModal.show();
}

function addEditItemRow(item = "", price = "", quantity = "1") {
    let container = document.getElementById('edit-items-container');
    let newRow = document.createElement('div');
    newRow.classList.add('row', 'mb-2', 'edit-item-row');
    newRow.style.paddingRight = "0";

    newRow.innerHTML = `
        <div class="input-group mb-2" style="padding-right: 0;">
            <input type="text" class="form-control edit-product" style="width: 30%" value="${item}" disabled />
            <span class="input-group-text">฿</span>
            <input type="number" class="form-control edit-price" value="${(Math.round(price * 100) / 100).toFixed(2)}" disabled />
            <input type="number" class="form-control edit-quantity" placeholder="Qty" min="1" value="${quantity}">
            <button onclick="removeEditItemRow(this)" class="form-control btn btn-danger btn-sm">Remove</button>
        </div>
    `;
    container.appendChild(newRow);
}

function removeEditItemRow(button) {
    button.parentNode.parentNode.remove();
}

async function loadEditProductData() {
    if (allProducts.length === 0) {
        allProducts = await eel.load_products()();
    }
    populateBootstrapDropdown('editProductDropdown', allProducts);
}

function addNewEditItemRow() {
    addEditItemRow();
}

async function submitEditOrder() {
    const originalDate = document.getElementById('original-order-date').value;
    const originalCustomer = document.getElementById('original-order-customer').value;
    const newCustomerName = document.getElementById('edit-customer-name').value;

    let productElements = document.querySelectorAll('.edit-product');
    let quantityElements = document.querySelectorAll('.edit-quantity');
    let priceElements = document.querySelectorAll('.edit-price');
    let discountType = document.getElementById('edit-discount-type').value;
    let discount = document.getElementById('edit-discount-input').value;
    let deliveryFee = document.getElementById('edit-delivery-fee').value;

    if (productElements.length === 0) {
        showAlertModal('Please add at least one product.');
        return;
    }

    // Validate discount
    if ((discountType === 'percentage' || discountType === 'amount') && (!discount || discount.trim() === '' || parseFloat(discount) <= 0)) {
        discountType = 'none';
        discount = '0';
    }

    // Ensure delivery fee has a valid value
    if (!deliveryFee || deliveryFee.trim() === '') {
        deliveryFee = '0';
    }

    let products = Array.from(productElements).map(el => el.value);
    let quantities = Array.from(quantityElements).map(el => el.value);
    let prices = Array.from(priceElements).map(el => el.value);

    await eel.edit_order(originalDate, originalCustomer, newCustomerName, products, quantities, prices, discountType, discount, deliveryFee)();
    bootstrap.Modal.getInstance(document.getElementById('editOrderModal')).hide();
    displayOrders();
}

async function deleteOrder(date, customer) {
    const confirmDeleteModal = new bootstrap.Modal(document.getElementById('confirmDeleteModal'));
    const confirmDeleteButton = document.getElementById('confirmDeleteButton');
    const confirmMessage = document.getElementById('confirmMessage');

    confirmMessage.innerText = `Are you sure you want to delete the order from ${customer} on ${date}?`;

    confirmDeleteButton.onclick = async function() {
        await eel.delete_order(date, customer)();
        displayOrders();
        confirmDeleteModal.hide();
    };

    confirmDeleteModal.show();
}

async function submitReceipt() {
    let customerElements = document.querySelector('.customer');
    let itemElements = document.querySelectorAll('.item');
    let quantityElements = document.querySelectorAll('.quantity');
    let priceElements = document.querySelectorAll('.price');
    let items = Array.from(itemElements).map(el => el.value);
    let quantities = Array.from(quantityElements).map(el => el.value);
    let prices = Array.from(priceElements).map(el => el.value);
    await eel.print_receipt(items, quantities, prices, customerElements.value);
}

async function syncOrder() {
    const spinnerWrapperEl = document.querySelector('.spinner-wrapper');
    const syncButton = document.getElementById('syncButton');
    syncButton.disabled = true;

    try
    {
        spinnerWrapperEl.style.opacity = 0.5;
		spinnerWrapperEl.style.display = 'flex';
        await eel.sync_orders_to_google_sheet()();
        showAlertModal("Orders synced successfully!");
    } catch (e) {
        showAlertModal("An error occurred while syncing orders.");
    } finally {
        syncButton.disabled = false;
        displayOrders();

        spinnerWrapperEl.style.opacity = 0;
		setTimeout(() => {
			spinnerWrapperEl.style.display = 'none';			
		}, 200);
    }
}