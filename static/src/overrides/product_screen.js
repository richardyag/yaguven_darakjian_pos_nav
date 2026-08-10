/** @odoo-module **/
// ProductScreen patch - extend, never rewrite:
//  1. Registers the FacetBar and CategoryTree components.
//  2. Exposes the button that opens the vertical tree.
//  3. Injects facet filtering over the visible product list.

import { patch } from "@web/core/utils/patch";
import { ProductScreen } from "@point_of_sale/app/screens/product_screen/product_screen";
import { DarakjianFacetBar } from "../app/facet_bar/facet_bar";
import { DarakjianCategoryTree } from "../app/category_tree/category_tree";
import { DarakjianBreadcrumb } from "../app/breadcrumb/breadcrumb";

patch(ProductScreen, {
    components: {
        ...ProductScreen.components,
        DarakjianFacetBar,
        DarakjianCategoryTree,
        DarakjianBreadcrumb,
    },
});

patch(ProductScreen.prototype, {
    openDarakjianTree() {
        this.pos.darakjianTreeOpen = true;
    },
    // Facet filtering does NOT belong here: the Odoo 19 grid iterates
    // pos.productToDisplayByCateg -> pos.productsToDisplay, both PosStore getters, and
    // never this component's `products` getter. The filter override lives in store.js
    // (PosStore.productsToDisplay), which is where it actually takes effect.
});
