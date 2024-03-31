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
    newRow.classList.add('row', 'mb-2', 'item_row'); // Add row class for Bootstrap grid

    newRow.innerHTML = `
				<div class="col-6">
						<input type="text" class="item form-control col-6" value="${item}" disabled />
				</div>
				<div class="input-group col-3" style="width: 25% !important">
						<span class="input-group-text">฿</span>
						<input type="text" class="price form-control" value="${(Math.round(price * 100) / 100).toFixed(2)}" disabled />
				</div>
				<div class="col-2">
						<input type="number" class="quantity form-control" placeholder="Qty" min="1" value="1">
				</div>
				<div class="col-1">
						<button onclick="removeItemRow(this)" class="btn btn-danger btn-sm">Remove</button> 
				</div>
		`;
    container.appendChild(newRow);
}

async function saveOrder() {
    let customer_name = document.querySelector('.customer').value;
    let itemElements = document.querySelectorAll('.item');
    let quantityElements = document.querySelectorAll('.quantity');
    let priceElements = document.querySelectorAll('.price');

    let items = Array.from(itemElements).map(el => el.value);
    let quantities = Array.from(quantityElements).map(el => el.value);
    let prices = Array.from(priceElements).map(el => el.value);

    await eel.save_order(items, quantities, prices, customer_name)();
    displayOrders();
}

async function displayOrders() {
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


        printCell.innerHTML = `
						<button class="btn btn-secondary" onclick="printReceipt('${order[1]}', '${order[2]}', '${order[3]}', '${order[4]}')">
								Print
						</button>
				`;
    });
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