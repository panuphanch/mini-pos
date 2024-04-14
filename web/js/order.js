let itemCount = 1;

async function loadProductData() {
    let productList = await eel.load_products()();

    const productSelect = document.getElementById('productSelect');
    productSelect.innerHTML = '';
    const selectOption = document.createElement('option');
    selectOption.value = "";
    selectOption.textContent = "เลือกเมนู";
    productSelect.appendChild(selectOption);
    
    productList.forEach(line => {
        const [_, item, price] = line;
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item;
        option.dataset.price = price;
        productSelect.appendChild(option);
    });
}

function removeItemRow(button) {
    button.parentNode.parentNode.remove(); // Remove the parent row
}

function addItemFromSelect(selectElement) {
    console.log(selectElement);
    const selectedItem = selectElement.value;
    const selectedPrice = selectElement.options[selectElement.selectedIndex].dataset.price;

    if (selectedItem) {
        addItemRow(selectedItem, selectedPrice);
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

    let customer_name = document.querySelector('.customer').value;
    let productElements = document.querySelectorAll('.product');
    let quantityElements = document.querySelectorAll('.quantity');
    let priceElements = document.querySelectorAll('.price');

    if (productElements.length === 0) {
        showAlertModal('Please add at least one product.');
        return;
    }

    let products = Array.from(productElements).map(el => el.value);
    let quantities = Array.from(quantityElements).map(el => el.value);
    let prices = Array.from(priceElements).map(el => el.value);

    await eel.save_order(products, quantities, prices, customer_name)();
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
        let totalCell = row.insertCell();
        let printCell = row.insertCell();
        printCell.classList.add('text-center');
        let deleteCell = row.insertCell();
        deleteCell.classList.add('text-center');

        let items = order[2].split(',');
        let quantities = order[3].split(',');
        let itemsHtml = '';

        items.forEach((item, index) => { // Include 'index'
            let itemName = item.trim();
            let quantity = quantities[index].trim(); // Access quantity by index

            itemsHtml += `${quantity}x ${itemName}<br>`;
        });

        dateCell.textContent = order[0];
        customerCell.textContent = order[1];
        itemsCell.innerHTML = itemsHtml;
        totalCell.textContent = "฿" + order[5];

        let customerName = order[1].replace(/'/g, "\\'");

        printCell.innerHTML = `
            <button class="btn btn-secondary" onclick="printReceipt('${customerName}', '${order[2]}', '${order[3]}', '${order[4]}')">
                Print
            </button>
        `;

        deleteCell.innerHTML = `
            <button class="btn" onclick="deleteOrder('${order[0]}', '${order[1]}')">
                <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" fill="red" class="bi bi-x-circle-fill" viewBox="0 0 16 16">
                    <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z"/>
                </svg>
            </button>
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

async function printReceipt(customer_name, items, quantities, prices) {
    const spinnerWrapperEl = document.querySelector('.spinner-wrapper');

	try {
        const itemList = items.split(',').map(item => item.trim());
        const quantityList = quantities.split(',').map(qty => qty.trim());
        const priceList = prices.split(',').map(price => price.trim());

        var result = await eel.print_receipt(itemList, quantityList, priceList, customer_name)();

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