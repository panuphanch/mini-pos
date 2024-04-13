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
    });

    $.fn.dataTable.moment('DD/MM/YYYY HH:mm');

    $('#orderTable').DataTable({
        "pageLength": 5,
        "lengthChange": false,
        "searching": false,
        "order": [[0, "desc"]]
    }).page(currentPage).draw('page');
}

async function printReceipt(customer_name, items, quantities, prices) {
    const itemList = items.split(',').map(item => item.trim());
    const quantityList = quantities.split(',').map(qty => qty.trim());
    const priceList = prices.split(',').map(price => price.trim());

    await eel.print_receipt(itemList, quantityList, priceList, customer_name);
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
    const syncButton = document.getElementById('syncButton');
    syncButton.disabled = true;

    try
    {
        await eel.sync_orders_to_google_sheet()();
        showAlertModal("Orders synced successfully!");
    } catch (e) {
        showAlertModal("An error occurred while syncing orders.");
    } finally {
        syncButton.disabled = false;
        displayOrders();
    }
}