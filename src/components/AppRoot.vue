<template>
  <transition name="view">
    <SageRouterView :key="route.path">
      <template #not-found>
        <View :padding="1" :gap="1" center cascade>
          <Row>
            <h1>404</h1>
            <h2>Page Not Found</h2>
          </Row>
        </View>
      </template>
    </SageRouterView>
  </transition>
</template>

<script setup lang="ts">
import { View, Row } from "@wearesage/vue";
import { SageRouterView, useRoute } from "../sage-router-pages";

const route = useRoute();
</script>
