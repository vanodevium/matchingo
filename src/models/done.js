export default class Done {
	constructor(order, sequence) {
		this.order = order;
		this.sequence = sequence;
		this.trades = [];
		this.processed = 0;
		this.left = 0;
		this.quantity = 0;
		this.stored = false;
		this.canceled = [];
		this.activated = [];
		this.activations = [];
	}
}
